import type { TurnFeatures } from '../types/turn.js';
import type { ILLMProvider } from '../types/providers.js';
import type { IFeatureExtractor, ExtractionContext } from './FeatureExtractor.js';
import { createLogger, type ILogger } from '../utils/logger.js';
import { EMPTY_FEATURES, parseLLMResponse } from './llm-response-parser.js';

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
        maxTokens: 600,
        systemPrompt: SYSTEM_PROMPT,
      });

      if (!result?.text) return { ...EMPTY_FEATURES };
      this.logger.debug('LLM response', result.text);
      return parseLLMResponse(result.text, turnId, this.logger);
    } catch (err) {
      this.logger.warn('LLM extraction failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return { ...EMPTY_FEATURES };
    }
  }
}

// ─── Prompt ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You extract amateur radio (ham radio) QSO features from ASR-transcribed voice text. The text comes from real radio audio and often contains significant ASR errors. Output JSON only.

CRITICAL: The input is ASR output from radio audio, NOT clean text. ASR commonly:
- Garbles NATO phonetic alphabet into nonsense or Chinese transliterations
- Mishears callsigns as Chinese words (e.g., "巴基连的" might be garbled phonetic spelling)
- Produces hallucinated subtitles (e.g., "字幕由Amara.org社群提供") — IGNORE these completely
- Mishears radio terms: "车速"→callsign(呼号), "抄收"→copy(收到), "炒杯"→QSO/copy

NATO phonetic alphabet — Chinese ASR commonly renders these as transliterations:
阿尔法/阿法=Alpha=A, 布拉沃=Bravo=B, 查理=Charlie=C, 德尔塔/三角洲=Delta=D,
回声/爱可=Echo=E, 狐步=Foxtrot=F, 高尔夫=Golf=G, 酒店/旅馆=Hotel=H,
印度=India=I, 朱丽叶=Juliet=J, 基洛=Kilo=K, 利马=Lima=L,
麦克=Mike=M, 诺文博/十一月=November=N, 奥斯卡=Oscar=O, 爸爸/帕帕=Papa=P,
魁北克=Quebec=Q, 罗密欧=Romeo=R, 是个/声/塞拉/西塞拉=Sierra=S,
探戈=Tango=T, 制服=Uniform=U, 胜利者=Victor=V, 威士忌=Whiskey=W,
X光=X-ray=X, 洋基=Yankee=Y, 祖鲁=Zulu=Z.
Example: "布拉沃高尔夫声阿尔法布拉沃是个" → Bravo Golf 7(声≈Seven) Alpha Bravo Sierra → reconstruct callsign letter by letter.

A monitored QSO typically has TWO callsigns (Station A ↔ Station B). Extract ALL callsigns you can find.

JSON schema:
{"cs":[{"v":"W1AW","c":0.9},{"v":"JA1ABC","c":0.8}],"rst":[{"v":"59","c":0.8}],"loc":[{"v":"Tokyo"}],"close":true,"cont":false,"start":false}

Fields (all optional, omit if not found):
- cs: callsigns (MOST IMPORTANT). Extract ALL callsigns in the text — there may be 2 or more.
  Format: PREFIX(1-3 chars) + DIGIT(1) + SUFFIX(1-4 letters). Examples: BG7ABS, BH8NE, W1AW.
  Chinese prefixes: BA/BD/BG/BH/BI/BJ/BL/BM/BN/BO/BP/BQ/BR/BS/BT/BU/BV/BW/BX/BY.
  DECODE phonetics letter by letter: "布拉沃"=B, "高尔夫"=G, "Hotel"=H, "November"=N, "Echo"=E.
  Also decode Chinese character phonetics: 北京的B, 上海的S, 湖南的H, etc.
  IMPORTANT: A single text may contain MULTIPLE callsigns. "这里是BG7ABS呼叫BH8NEY" → extract BOTH.
- rst: signal reports. 2 digits, R(1-5)+S(1-9). "五九"/"五个九"/"59加"=59, "five nine"=59. "596"=59(+6dB).
- loc: QTH/location. Chinese provinces, cities. "湘西"=Xiangxi(Hunan). "贵州"=Guizhou.
- grid: Maidenhead grid locators (e.g. FN31, OL74kd).
- nm: operator names. RARE in ham radio — only extract if explicitly stated (e.g. "我叫..."). Do NOT guess names from garbled ASR text.
- close: true if farewell (73, 七三, 再见, good DX, 关机, 收台, 感谢联络).
- cont: true if acknowledgment (roger, copy, 收到, 抄收, 明白, go ahead, over, 请讲).
- start: true if CQ/calling (CQ, QRZ, 呼叫, 有人吗).
- v=value, c=confidence(0-1). Higher c for clear phonetic spelling, lower for guessed from garbled text.
- Only extract what you clearly hear. Do NOT repeat information from previous turns unless it appears in the current turn.`;

function buildPrompt(
  text: string,
  context?: ExtractionContext,
  history?: Array<{ text: string; turnId?: string }>,
): string {
  const sections: string[] = [];

  // Include recent history as context (sliding window)
  if (history && history.length > 1) {
    sections.push('Recent turns (ASR transcriptions, may contain errors):');
    for (let i = 0; i < history.length - 1; i++) {
      const truncated = history[i].text.length > 150
        ? history[i].text.substring(0, 150) + '...'
        : history[i].text;
      sections.push(`[${i + 1}] ${truncated}`);
    }
    sections.push('');
    sections.push('Current turn to extract from:');
  }

  sections.push(`"${text}"`);

  // Context hints
  const hints: string[] = [];
  if (context?.myCallsign && context.myCallsign !== 'LISTENER') {
    hints.push(`My callsign: ${context.myCallsign}`);
  }
  if (context?.knownCallsigns?.length) {
    hints.push(`Known stations in this QSO: ${context.knownCallsigns.join(', ')}`);
  }
  if (context?.frequency) {
    const mhz = (context.frequency / 1_000_000).toFixed(3);
    hints.push(`Frequency: ${mhz} MHz ${context.mode || ''}`);
  }
  if (context?.language) {
    hints.push(`Language: ${context.language === 'zh' ? 'Chinese' : context.language}`);
  }

  if (hints.length > 0) {
    sections.push('\nContext: ' + hints.join('. '));
  }

  return sections.join('\n');
}

// Parsing and validation are in llm-response-parser.ts (shared with OmniConversationProcessor)
