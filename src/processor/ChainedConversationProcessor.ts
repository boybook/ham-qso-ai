import type { ITurnProcessor, TurnProcessorResult, ContextUpdate, ASROptions, ASRResult } from '../types/providers.js';
import { encodeWav } from '../utils/audio-utils.js';
import { createLogger, type ILogger } from '../utils/logger.js';
import { EMPTY_FEATURES, parseLLMResponse } from '../extraction/llm-response-parser.js';
import { RuleBasedFeatureExtractor } from '../extraction/FeatureExtractor.js';
import type { TurnFeatures, SignalHit } from '../types/turn.js';
import type { FieldCandidate, QSODraft } from '../types/qso.js';

/** Minimal ASR interface */
interface ASRTranscriber {
  readonly name?: string;
  initialize(): Promise<void>;
  transcribe(audio: Float32Array, sampleRate: number, options?: ASROptions): Promise<ASRResult | null>;
  dispose(): Promise<void>;
}

export interface ChainedConversationProcessorConfig {
  /** ASR provider (e.g., Qwen3ASRProvider with qwen3-asr-flash) */
  asr: ASRTranscriber;
  /** API key for the conversation LLM */
  llmApiKey: string;
  /** LLM model for conversation-based extraction (default: 'qwen3-omni-flash') */
  llmModel?: string;
  /** LLM base URL (default: DashScope) */
  llmBaseURL?: string;
  /** Language hint */
  language?: string;
  /** Operator's callsign */
  myCallsign?: string;
  /** Max active turns in current QSO before trimming (default: 30) */
  maxConversationTurns?: number;
  /** Max history QSO summaries to retain (default: 5) */
  maxHistoryQSOs?: number;
  /** Logger */
  logger?: ILogger;
}

// ─── LLM System Prompt ─────────────────────────────────────────

const SYSTEM_PROMPT_ZH = `你是业余无线电通联的实时分析系统。你会逐段收到 ASR 转录文本，从中提取结构化 QSO 信息。

规则：
- 只输出 JSON，不要输出任何解释或额外文字
- 输入是 ASR 转录，可能包含大量错误（音标被转为中文、呼号被听错等）
- 如果输入为空或无意义，返回 {}

ASR 常见错误模式：
- NATO 音标被转为中文音译："布拉沃"=Bravo=B, "高尔夫"=Golf=G, "酒店"=Hotel=H, "十一月"=November=N, "回声"=Echo=E, "塞拉"=Sierra=S 等
- "车速"→呼号(callsign), "抄收/拷贝"→copy(收到)
- 数字分区说法："七区电台"→7区前缀, "八七电台"→87=BH8..7区

呼号格式：前缀(1-3字符)+数字(1位)+后缀(1-4字母)。
中国前缀：BA/BD/BG/BH/BY 等。通联中通常有两个电台，请提取所有呼号。
从 NATO 音标逐字母还原呼号。

信号报告：五九(59)、五九加(59+)。术语：抄收、Over、73、七三、再见、QTH。

loc 字段只提取明确的 QTH 自报位置，如"我在XX"、"QTH XX"、"这里是XX"、"我的地址是XX"。
路过提到、对比举例、设备品牌、网络运营商等不算 QTH，不要提取。

JSON（只含实际出现的字段）：
{"cs":[{"v":"呼号","c":0.9}],"rst":[{"v":"59","c":0.8}],"loc":[{"v":"地名"}],"close":false,"cont":false,"start":false}

参考之前轮次帮助理解当前文本。只提取当前段的内容。`;

const SYSTEM_PROMPT_EN = `You are a real-time amateur radio QSO analysis system. You receive ASR transcription text and extract structured QSO features.

Rules:
- Output JSON only. No explanations.
- Input is ASR output with possible errors (phonetics garbled, callsigns misheard).
- If input is empty or meaningless, return {}.

Callsign format: PREFIX(1-3 chars)+DIGIT(1)+SUFFIX(1-4 letters). Decode NATO phonetics. Extract ALL callsigns.
Signal reports: "five nine"=59. Terms: CQ, copy, roger, 73, over, QTH.

JSON (only include fields actually found):
{"cs":[{"v":"CALLSIGN","c":0.9}],"rst":[{"v":"59","c":0.8}],"loc":[{"v":"place"}],"close":false,"cont":false,"start":false}

Reference previous turns for context. Only extract from the CURRENT text.`;

// ─── Three-Zone Context Types ────────────────────────────────────

/** Compressed summary of a closed QSO (stored in History Zone) */
interface QSOSummaryRecord {
  /** Participating stations, e.g. "BG7ABS↔BH8YFG" */
  stations: string;
  /** Directional RST, e.g. "59/57" */
  rst: string;
  /** QTH notes, comma-joined */
  notes: string;
  /** Timestamp when QSO closed (for "N min ago" formatting) */
  closedAt: number;
  /** Internal draft ID, not sent to LLM */
  qsoId: string;
}

/**
 * Three-zone LLM context:
 *
 * Anchor Zone  — known station summaries (from StationRegistry, dynamic)
 * History Zone — compressed summaries of closed QSOs (FIFO, bounded)
 * Active Zone  — full turns of the current QSO (bounded by maxActiveTurns)
 *
 * buildMessages() assembles these into a flat messages[] for the LLM API.
 */
interface ThreeZoneContext {
  anchorStations: Array<{ callsign: string; qth?: string; name?: string }>;
  historyZone: QSOSummaryRecord[];
  activeZone: Array<{ role: string; content: string }>;
  currentQsoId: string | null;
}

/**
 * Chained Conversation Processor:
 * ASR (qwen3-asr-flash) → Multi-turn LLM conversation (qwen3.5-flash)
 *
 * Best of both worlds:
 * - ASR: dedicated model with best Chinese transcription quality
 * - LLM: persistent multi-turn conversation maintains context across turns
 *
 * Uses a Three-Zone context model to bound token usage:
 *   [System Prompt] [Anchor: known stations] [History: past QSO summaries] [Active: current QSO turns]
 *
 * QSO lifecycle integration (called by QSOPipeline):
 *   onQSOStart(id)   — clears Active Zone for new QSO
 *   onQSOClose(draft)— compresses Active Zone into History Zone
 *   updateStationSummary(stations) — refreshes Anchor Zone
 */
export class ChainedConversationProcessor implements ITurnProcessor {
  readonly name = 'chained-conversation';
  private readonly config: ChainedConversationProcessorConfig;
  private readonly asr: ASRTranscriber;
  private readonly ruleExtractor: RuleBasedFeatureExtractor;
  private readonly logger: ILogger;
  private readonly maxActiveTurns: number;
  private readonly maxHistoryQSOs: number;
  private client: any = null;

  // Three-zone LLM context
  private threeZone: ThreeZoneContext;
  private radioContext: { myCallsign?: string; frequency?: number; mode?: string; knownCallsigns?: string[] } = {};
  private language: string;

  constructor(config: ChainedConversationProcessorConfig) {
    this.config = config;
    this.asr = config.asr;
    this.ruleExtractor = new RuleBasedFeatureExtractor();
    this.language = config.language ?? 'zh';
    this.maxActiveTurns = config.maxConversationTurns ?? 30;
    this.maxHistoryQSOs = config.maxHistoryQSOs ?? 5;
    this.logger = createLogger('ChainedConversation', config.logger);
    if (config.myCallsign) this.radioContext.myCallsign = config.myCallsign;
    this.threeZone = this.createEmptyContext();
  }

  async initialize(): Promise<void> {
    await this.asr.initialize();

    const { default: OpenAI } = await import('openai');
    this.client = new OpenAI({
      apiKey: this.config.llmApiKey,
      baseURL: this.config.llmBaseURL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    });

    this.logger.info('initialized', {
      asr: this.asr.name ?? 'asr',
      llm: this.config.llmModel ?? 'qwen3-omni-flash',
      maxActiveTurns: this.maxActiveTurns,
      maxHistoryQSOs: this.maxHistoryQSOs,
    });
  }

  /**
   * Callback for LLM results arriving asynchronously.
   * Set by the pipeline to handle late-arriving features.
   */
  onLateFeatures?: (turnText: string, features: TurnFeatures) => void;

  async processTurn(audio: Float32Array, sampleRate: number): Promise<TurnProcessorResult> {
    // Step 1: ASR transcription (fast, ~1-2s)
    const asrResult = await this.asr.transcribe(audio, sampleRate, {
      language: this.language,
    });

    if (!asrResult?.text.trim()) {
      return { text: '', confidence: 0, features: { ...EMPTY_FEATURES }, provider: this.name };
    }

    const asrText = asrResult.text;

    // Step 2: Rule-based extraction (instant, synchronous)
    const ruleFeatures = this.ruleExtractor.extract(asrText);

    // Step 3: Fire-and-forget LLM extraction (async, doesn't block return)
    // LLM results will be merged when they arrive via onLateFeatures callback.
    this.fireLLMExtraction(asrText, ruleFeatures);

    // Return immediately with ASR text + rule features
    return {
      text: asrText,
      confidence: asrResult.confidence,
      features: ruleFeatures,
      provider: this.name,
    };
  }

  /**
   * Start LLM extraction in background. Results are delivered via onLateFeatures.
   */
  private fireLLMExtraction(asrText: string, ruleFeatures: TurnFeatures): void {
    this.extractWithConversation(asrText).then(llmFeatures => {
      const merged = this.mergeFeatures(ruleFeatures, llmFeatures);
      this.onLateFeatures?.(asrText, merged);
    }).catch(err => {
      this.logger.warn('async LLM extraction failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  updateContext(update: ContextUpdate): void {
    if (update.frequency !== undefined) this.radioContext.frequency = update.frequency;
    if (update.mode !== undefined) this.radioContext.mode = update.mode;
    if (update.myCallsign !== undefined) this.radioContext.myCallsign = update.myCallsign;
    if (update.knownCallsigns) {
      const existing = new Set(this.radioContext.knownCallsigns ?? []);
      for (const cs of update.knownCallsigns) existing.add(cs);
      this.radioContext.knownCallsigns = [...existing];
    }
  }

  /**
   * Called when a new QSO session starts (by QSOPipeline.handleSessionStarted).
   * Clears the Active Zone to start fresh for the new QSO.
   */
  onQSOStart(qsoId: string): void {
    this.threeZone.activeZone = [];
    this.threeZone.currentQsoId = qsoId;
    this.logger.debug('QSO started, active zone cleared', { qsoId });
  }

  /**
   * Called when a QSO session closes (by QSOPipeline.handleSessionClosed).
   * Compresses the Active Zone into a QSO summary and appends to History Zone.
   */
  onQSOClose(draft: QSODraft): void {
    if (this.threeZone.activeZone.length === 0) return;

    const summary = this.buildQSOSummary(draft);
    this.threeZone.historyZone.push(summary);
    if (this.threeZone.historyZone.length > this.maxHistoryQSOs) {
      this.threeZone.historyZone.shift();
    }
    this.threeZone.activeZone = [];
    this.threeZone.currentQsoId = null;
    this.logger.debug('QSO closed, history zone updated', {
      historyCount: this.threeZone.historyZone.length,
      summary: summary.stations,
    });
  }

  /**
   * Refresh the Anchor Zone with current known stations (from StationRegistry).
   * Called by QSOPipeline after onLateFeatures arrives.
   */
  updateStationSummary(stations: Array<{ callsign: string; qth?: string; name?: string }>): void {
    this.threeZone.anchorStations = stations
      .filter(s => s.callsign)
      .slice(0, 10); // cap at 10 stations to bound anchor zone size
  }

  /**
   * Full reset: clears Active Zone + History Zone on frequency change.
   * Anchor Zone (station knowledge) is preserved — it's frequency-independent.
   */
  reset(): void {
    this.threeZone.activeZone = [];
    this.threeZone.historyZone = [];
    this.threeZone.currentQsoId = null;
    this.radioContext.knownCallsigns = [];
    this.logger.info('context reset (frequency change)');
  }

  async dispose(): Promise<void> {
    await this.asr.dispose();
    this.threeZone = this.createEmptyContext();
    this.client = null;
  }

  // ─── Three-Zone Context ───────────────────────────────────────

  private createEmptyContext(): ThreeZoneContext {
    return {
      anchorStations: [],
      historyZone: [],
      activeZone: [],
      currentQsoId: null,
    };
  }

  /**
   * Assemble all three zones into a flat messages[] array for the LLM API.
   *
   * Structure:
   *   [system]
   *   [user: anchor zone]  [assistant: 已记录]   -- if any known stations
   *   [user: history zone] [assistant: 已记录]   -- if any past QSOs
   *   ...active zone user/assistant pairs...
   */
  private buildMessages(): Array<{ role: string; content: string }> {
    const prompt = this.language === 'zh' ? SYSTEM_PROMPT_ZH : SYSTEM_PROMPT_EN;
    const result: Array<{ role: string; content: string }> = [
      { role: 'system', content: prompt },
    ];

    // Anchor zone: known stations summary
    if (this.threeZone.anchorStations.length > 0) {
      const stationText = this.threeZone.anchorStations
        .map(s => {
          const parts = [s.callsign];
          if (s.qth) parts.push(s.qth);
          if (s.name) parts.push(s.name);
          return parts.join(':');
        })
        .join(' | ');
      result.push({ role: 'user', content: `[已知电台]\n${stationText}` });
      result.push({ role: 'assistant', content: '已记录' });
    }

    // History zone: past QSO summaries
    if (this.threeZone.historyZone.length > 0) {
      const historyText = this.threeZone.historyZone.map((record, i) => {
        const minAgo = Math.round((Date.now() - record.closedAt) / 60000);
        const timeStr = minAgo < 1 ? '刚刚' : `${minAgo}min前`;
        const parts = [`${i + 1}. ${record.stations}`];
        if (record.rst) parts.push(`RST:${record.rst}`);
        if (record.notes) parts.push(record.notes);
        parts.push(`[${timeStr}]`);
        return parts.join(' ');
      }).join('\n');
      result.push({ role: 'user', content: `[历史通联]\n${historyText}` });
      result.push({ role: 'assistant', content: '已记录' });
    }

    // Active zone: current QSO turns
    result.push(...this.threeZone.activeZone);

    return result;
  }

  /** Build a compact summary record from a closed QSODraft */
  private buildQSOSummary(draft: QSODraft): QSOSummaryRecord {
    const stations = draft.stations.map(s => s.callsign).join('↔') || '?';

    const rstA = draft.rstAtoB?.value;
    const rstB = draft.rstBtoA?.value;
    let rst = '';
    if (rstA && rstB) rst = `${rstA}/${rstB}`;
    else if (rstA) rst = rstA;
    else if (rstB) rst = rstB;

    const notes = draft.stations
      .map(s => s.qth)
      .filter((q): q is string => Boolean(q))
      .join(',');

    return { stations, rst, notes, closedAt: Date.now(), qsoId: draft.id };
  }

  // ─── LLM Conversation ────────────────────────────────────────

  private async extractWithConversation(asrText: string): Promise<TurnFeatures> {
    if (!this.client) return { ...EMPTY_FEATURES };

    // Build user message: ASR text + optional context hints
    let userContent = asrText;
    const hints: string[] = [];
    if (this.radioContext.knownCallsigns?.length) {
      hints.push(`[已知电台: ${this.radioContext.knownCallsigns.join(', ')}]`);
    }
    if (this.radioContext.frequency) {
      hints.push(`[${(this.radioContext.frequency / 1e6).toFixed(3)} MHz ${this.radioContext.mode ?? ''}]`);
    }
    if (hints.length > 0) {
      userContent = hints.join(' ') + '\n' + asrText;
    }

    // Append to Active Zone
    this.threeZone.activeZone.push({ role: 'user', content: userContent });

    // Assemble full messages from three zones
    const messages = this.buildMessages();

    try {
      const model = this.config.llmModel ?? 'qwen3-omni-flash';
      const response = await this.client.chat.completions.create({
        model,
        messages,
        temperature: 0,
        max_tokens: 400,
        response_format: { type: 'json_object' },
        ...(model.startsWith('qwen3') ? { enable_thinking: false } : {}),
      });

      const choice = response.choices?.[0];
      const responseText = choice?.message?.content ?? '';

      // Check if thinking mode leaked through (debug)
      const reasoning = (choice?.message as any)?.reasoning_content;
      if (reasoning) {
        this.logger.warn('thinking mode is ACTIVE despite enable_thinking:false', {
          reasoningLength: reasoning.length,
        });
      }

      // Add assistant response to Active Zone
      this.threeZone.activeZone.push({ role: 'assistant', content: responseText });
      this.trimActiveZone();

      if (!responseText.trim()) return { ...EMPTY_FEATURES };

      this.logger.debug('LLM response', responseText);
      return parseLLMResponse(responseText, undefined, this.logger);
    } catch (err) {
      // Remove failed user message from Active Zone
      this.threeZone.activeZone.pop();
      this.logger.warn('LLM extraction failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return { ...EMPTY_FEATURES };
    }
  }

  /** Trim Active Zone to maxActiveTurns * 2 messages (keep most recent) */
  private trimActiveZone(): void {
    const maxMessages = this.maxActiveTurns * 2;
    if (this.threeZone.activeZone.length > maxMessages) {
      this.threeZone.activeZone = this.threeZone.activeZone.slice(-maxMessages);
      this.logger.debug('active zone trimmed', { messageCount: this.threeZone.activeZone.length });
    }
  }

  // ─── Feature Merging ─────────────────────────────────────────

  private mergeFeatures(rule: TurnFeatures, llm: TurnFeatures): TurnFeatures {
    return {
      callsignCandidates: this.mergeCandidates(rule.callsignCandidates, llm.callsignCandidates),
      rstCandidates: this.mergeCandidates(rule.rstCandidates, llm.rstCandidates),
      nameCandidates: this.mergeCandidates(rule.nameCandidates, llm.nameCandidates),
      qthCandidates: this.mergeCandidates(rule.qthCandidates, llm.qthCandidates),
      gridCandidates: this.mergeCandidates(rule.gridCandidates, llm.gridCandidates),
      closingSignals: rule.closingSignals.length > 0 ? rule.closingSignals : llm.closingSignals,
      continuationSignals: rule.continuationSignals.length > 0 ? rule.continuationSignals : llm.continuationSignals,
      qsoStartSignals: rule.qsoStartSignals.length > 0 ? rule.qsoStartSignals : llm.qsoStartSignals,
    };
  }

  private mergeCandidates<T>(rule: FieldCandidate<T>[], llm: FieldCandidate<T>[]): FieldCandidate<T>[] {
    const result = [...rule];
    const ruleValues = new Set(rule.map(c => String(c.value)));
    for (const c of llm) {
      if (!ruleValues.has(String(c.value))) result.push(c);
    }
    return result;
  }
}
