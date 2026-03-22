import type { TurnFeatures, SignalHit } from '../types/turn.js';
import type { FieldCandidate } from '../types/qso.js';
import type { ILLMProvider } from '../types/providers.js';
import type { IFeatureExtractor, ExtractionContext } from './FeatureExtractor.js';
import { createLogger, type ILogger } from '../utils/logger.js';
import { isValidCallsign, isValidGrid } from '../utils/ham-utils.js';

const EMPTY_FEATURES: TurnFeatures = {
  callsignCandidates: [],
  rstCandidates: [],
  nameCandidates: [],
  qthCandidates: [],
  gridCandidates: [],
  closingSignals: [],
  continuationSignals: [],
  qsoStartSignals: [],
};

/**
 * LLM-based feature extractor.
 * Delegates feature extraction to a language model via structured prompts.
 * More accurate for complex/multilingual text, but slower and costs money.
 */
export class LLMFeatureExtractor implements IFeatureExtractor {
  private readonly llm: ILLMProvider;
  private readonly logger: ILogger;
  private readonly maxHistoryTurns: number;
  private readonly history: Array<{ text: string; turnId?: string }> = [];

  /**
   * @param llm LLM provider
   * @param options.maxHistoryTurns Sliding window size — how many recent turns
   *        to include as context (default 5). More context = better extraction
   *        but higher token cost.
   */
  constructor(llm: ILLMProvider, options?: { logger?: ILogger; maxHistoryTurns?: number }) {
    this.llm = llm;
    this.logger = createLogger('LLMFeatureExtractor', options?.logger);
    this.maxHistoryTurns = options?.maxHistoryTurns ?? 5;
  }

  async extract(text: string, turnId?: string, context?: ExtractionContext): Promise<TurnFeatures> {
    if (!text.trim()) return { ...EMPTY_FEATURES };

    // Add to sliding window
    this.history.push({ text, turnId });
    while (this.history.length > this.maxHistoryTurns) {
      this.history.shift();
    }

    try {
      const prompt = buildPrompt(text, context, this.history);
      const result = await this.llm.complete(prompt, {
        jsonMode: true,
        temperature: 0,
        maxTokens: 400,
        systemPrompt: SYSTEM_PROMPT,
      });

      if (!result?.text) return { ...EMPTY_FEATURES };
      this.logger.debug('LLM response', result.text);
      return parseAndValidate(result.text, turnId, this.logger);
    } catch (err) {
      this.logger.warn('LLM extraction failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return { ...EMPTY_FEATURES };
    }
  }
}

// ─── Prompt ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You extract amateur radio QSO features from transcribed voice text. Output JSON only.

Schema:
{"cs":[{"v":"W1AW","c":0.9}],"rst":[{"v":"59","c":0.8}],"nm":[{"v":"John"}],"loc":[{"v":"Connecticut"}],"grid":[{"v":"FN31"}],"close":true,"cont":false,"start":false}

Fields (all optional, omit if not found):
- cs: callsigns. Format: 1-3 alphanumeric + 1 digit + 1-4 letters. Decode phonetics: Alpha=A, Bravo=B... 北京的B, 上海的S...
- rst: signal reports. 2 digits, R(1-5)+S(1-9). 五九=59, five nine=59.
- nm: operator names mentioned.
- loc: QTH/locations mentioned.
- grid: Maidenhead grid locators (e.g. FN31, PM84ol).
- close: true if farewell detected (73, 七三, 再见, good DX, thanks for QSO).
- cont: true if continuation detected (roger, copy, 收到, go ahead).
- start: true if CQ/calling detected.
- v=value, c=confidence(0-1).`;

function buildPrompt(
  text: string,
  context?: ExtractionContext,
  history?: Array<{ text: string; turnId?: string }>,
): string {
  let prompt = '';

  // Include recent history as context (sliding window)
  if (history && history.length > 1) {
    prompt += 'Recent conversation:\n';
    for (let i = 0; i < history.length - 1; i++) {
      // Truncate old turns to save tokens
      const truncated = history[i].text.length > 100
        ? history[i].text.substring(0, 100) + '...'
        : history[i].text;
      prompt += `[${i + 1}] ${truncated}\n`;
    }
    prompt += '\nCurrent turn to extract from:\n';
  }

  prompt += `"${text}"`;

  if (context?.myCallsign && context.myCallsign !== 'LISTENER') {
    prompt += `\nMy call: ${context.myCallsign}`;
  }
  if (context?.knownCallsigns?.length) {
    prompt += `\nKnown: ${context.knownCallsigns.join(' ')}`;
  }
  return prompt;
}

// ─── JSON parsing with auto-correction ──────────────────────────────

function extractJSON(raw: string): string {
  // Strip markdown code fences
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }
  // Find first { and last }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in LLM response');
  }
  return cleaned.substring(start, end + 1);
}

function parseAndValidate(raw: string, turnId: string | undefined, logger: ILogger): TurnFeatures {
  let parsed: LLMResponse;
  try {
    parsed = JSON.parse(extractJSON(raw));
  } catch (err) {
    logger.warn('Failed to parse LLM JSON response', { raw: raw.substring(0, 200) });
    return { ...EMPTY_FEATURES };
  }

  // Guard: if parsed is not an object, bail
  if (!parsed || typeof parsed !== 'object') return { ...EMPTY_FEATURES };

  const now = Date.now();

  return {
    callsignCandidates: validateCallsigns(parsed.cs, turnId, now),
    rstCandidates: validateRST(parsed.rst, turnId, now),
    nameCandidates: validateStrings(parsed.nm, turnId, now),
    qthCandidates: validateStrings(parsed.loc, turnId, now),
    gridCandidates: validateGrids(parsed.grid, turnId, now),
    closingSignals: parsed.close ? [{ type: 'farewell', matchedText: '', position: 0, confidence: 0.8 }] : [],
    continuationSignals: parsed.cont ? [{ type: 'acknowledgment', matchedText: '', position: 0, confidence: 0.7 }] : [],
    qsoStartSignals: parsed.start ? [{ type: 'cq', matchedText: '', position: 0, confidence: 0.8 }] : [],
  };
}

// ─── Field-level validators ─────────────────────────────────────────

function clampConfidence(c: unknown): number {
  const n = typeof c === 'number' ? c : 0.7;
  return Math.max(0, Math.min(1, n));
}

function validateCallsigns(items: unknown, turnId: string | undefined, now: number): FieldCandidate<string>[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is { v: string; c?: number } =>
      item && typeof item === 'object' && typeof (item as any).v === 'string'
    )
    .map(item => {
      let value = String(item.v).toUpperCase().trim();
      // Auto-correct: strip trailing punctuation
      value = value.replace(/[.,;:!?]+$/, '');
      // Auto-correct: strip portable suffix for validation, keep in value
      return { value, confidence: clampConfidence(item.c) };
    })
    .filter(item => isValidCallsign(item.value))
    .map(item => ({
      value: item.value,
      confidence: item.confidence,
      source: 'llm' as const,
      sourceTurnId: turnId,
      createdAt: now,
    }));
}

function validateRST(items: unknown, turnId: string | undefined, now: number): FieldCandidate<string>[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is { v: string; c?: number } =>
      item && typeof item === 'object' && typeof (item as any).v === 'string'
    )
    .map(item => {
      let value = String(item.v).trim();
      // Auto-correct: strip non-digit characters
      value = value.replace(/[^0-9]/g, '');
      return { value, confidence: clampConfidence(item.c) };
    })
    .filter(item => {
      // Validate: 2-3 digits, R in 1-5, S in 1-9
      if (item.value.length < 2 || item.value.length > 3) return false;
      const r = parseInt(item.value[0], 10);
      const s = parseInt(item.value[1], 10);
      if (r < 1 || r > 5 || s < 1 || s > 9) return false;
      return true;
    })
    .map(item => ({
      value: item.value,
      confidence: item.confidence,
      source: 'llm' as const,
      sourceTurnId: turnId,
      createdAt: now,
    }));
}

function validateGrids(items: unknown, turnId: string | undefined, now: number): FieldCandidate<string>[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is { v: string; c?: number } =>
      item && typeof item === 'object' && typeof (item as any).v === 'string'
    )
    .map(item => ({
      value: String(item.v).toUpperCase().trim(),
      confidence: clampConfidence(item.c),
    }))
    .filter(item => isValidGrid(item.value))
    .map(item => ({
      value: item.value,
      confidence: item.confidence,
      source: 'llm' as const,
      sourceTurnId: turnId,
      createdAt: now,
    }));
}

function validateStrings(items: unknown, turnId: string | undefined, now: number): FieldCandidate<string>[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is { v: string; c?: number } =>
      item && typeof item === 'object' && typeof (item as any).v === 'string'
    )
    .map(item => String(item.v).trim())
    .filter(v => v.length > 0 && v.length < 100) // Sanity: not empty, not absurdly long
    .map(v => ({
      value: v,
      confidence: 0.7,
      source: 'llm' as const,
      sourceTurnId: turnId,
      createdAt: now,
    }));
}

// ─── Response type ──────────────────────────────────────────────────

interface LLMResponse {
  cs?: unknown;
  rst?: unknown;
  nm?: unknown;
  loc?: unknown;
  grid?: unknown;
  close?: boolean;
  cont?: boolean;
  start?: boolean;
}
