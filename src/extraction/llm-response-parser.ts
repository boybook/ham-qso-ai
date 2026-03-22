/**
 * Shared LLM response parsing and validation utilities.
 *
 * Used by both LLMFeatureExtractor (chained mode) and
 * OmniConversationProcessor (unified mode) to parse structured
 * JSON responses from LLMs into validated TurnFeatures.
 */
import type { TurnFeatures } from '../types/turn.js';
import type { FieldCandidate } from '../types/qso.js';
import type { ILogger } from '../utils/logger.js';
import { isValidCallsign, isValidGrid } from '../utils/ham-utils.js';

// ─── Constants ──────────────────────────────────────────────────

export const EMPTY_FEATURES: TurnFeatures = {
  callsignCandidates: [],
  rstCandidates: [],
  nameCandidates: [],
  qthCandidates: [],
  gridCandidates: [],
  closingSignals: [],
  continuationSignals: [],
  qsoStartSignals: [],
};

// ─── JSON extraction ────────────────────────────────────────────

/**
 * Extract a JSON object from raw LLM response text.
 * Handles markdown code fences and surrounding text.
 */
export function extractJSON(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in LLM response');
  }
  return cleaned.substring(start, end + 1);
}

// ─── Response parsing ───────────────────────────────────────────

export interface LLMResponse {
  text?: string;
  cs?: unknown;
  rst?: unknown;
  nm?: unknown;
  loc?: unknown;
  grid?: unknown;
  close?: boolean;
  cont?: boolean;
  start?: boolean;
}

/**
 * Parse and validate an LLM JSON response into TurnFeatures.
 * Returns EMPTY_FEATURES on parse failure.
 */
export function parseLLMResponse(raw: string, turnId: string | undefined, logger: ILogger): TurnFeatures {
  let parsed: LLMResponse;
  try {
    parsed = JSON.parse(extractJSON(raw));
  } catch {
    logger.warn('Failed to parse LLM JSON response', { raw: raw.substring(0, 200) });
    return { ...EMPTY_FEATURES };
  }

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

/**
 * Extract the transcribed text from a unified LLM response.
 * Returns empty string if not present.
 */
export function extractTextFromResponse(raw: string): string {
  try {
    const parsed = JSON.parse(extractJSON(raw));
    return typeof parsed?.text === 'string' ? parsed.text : '';
  } catch {
    return '';
  }
}

// ─── Field-level validators ─────────────────────────────────────

export function clampConfidence(c: unknown): number {
  const n = typeof c === 'number' ? c : 0.7;
  return Math.max(0, Math.min(1, n));
}

export function validateCallsigns(items: unknown, turnId: string | undefined, now: number): FieldCandidate<string>[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is { v: string; c?: number } =>
      item && typeof item === 'object' && typeof (item as any).v === 'string'
    )
    .map(item => {
      let value = String(item.v).toUpperCase().trim();
      value = value.replace(/[.,;:!?]+$/, '');
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

export function validateRST(items: unknown, turnId: string | undefined, now: number): FieldCandidate<string>[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is { v: string; c?: number } =>
      item && typeof item === 'object' && typeof (item as any).v === 'string'
    )
    .map(item => {
      let value = String(item.v).trim();
      value = value.replace(/[^0-9]/g, '');
      return { value, confidence: clampConfidence(item.c) };
    })
    .filter(item => {
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

export function validateGrids(items: unknown, turnId: string | undefined, now: number): FieldCandidate<string>[] {
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

export function validateStrings(items: unknown, turnId: string | undefined, now: number): FieldCandidate<string>[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is { v: string; c?: number } =>
      item && typeof item === 'object' && typeof (item as any).v === 'string'
    )
    .map(item => String(item.v).trim())
    .filter(v => v.length > 0 && v.length < 100)
    .map(v => ({
      value: v,
      confidence: 0.7,
      source: 'llm' as const,
      sourceTurnId: turnId,
      createdAt: now,
    }));
}
