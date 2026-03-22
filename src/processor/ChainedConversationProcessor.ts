import type { ITurnProcessor, TurnProcessorResult, ContextUpdate, ASROptions, ASRResult } from '../types/providers.js';
import { encodeWav } from '../utils/audio-utils.js';
import { createLogger, type ILogger } from '../utils/logger.js';
import { EMPTY_FEATURES, parseLLMResponse } from '../extraction/llm-response-parser.js';
import { RuleBasedFeatureExtractor } from '../extraction/FeatureExtractor.js';
import type { TurnFeatures, SignalHit } from '../types/turn.js';
import type { FieldCandidate } from '../types/qso.js';

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
  /** Max conversation turns before trimming (default: 30) */
  maxConversationTurns?: number;
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

/**
 * Chained Conversation Processor:
 * ASR (qwen3-asr-flash) → Multi-turn LLM conversation (qwen3-omni-flash)
 *
 * Best of both worlds:
 * - ASR: dedicated model with best Chinese transcription quality
 * - LLM: persistent multi-turn conversation maintains context across turns
 *
 * The LLM conversation accumulates turn-by-turn:
 *   System: 你是分析系统...
 *   User: "CQ CQ CQ 这里是七区电台 Bravo Golf 7 Alpha Bravo Sierra"
 *   Assistant: {"cs":[{"v":"BG7ABS","c":0.9}],"start":true}
 *   User: "抄收 五九 贵州凯里 Over"
 *   Assistant: {"rst":[{"v":"59","c":0.9}],"loc":[{"v":"贵州凯里"}],"cont":true}
 *   ...LLM naturally has full context from previous analysis
 */
export class ChainedConversationProcessor implements ITurnProcessor {
  readonly name = 'chained-conversation';
  private readonly config: ChainedConversationProcessorConfig;
  private readonly asr: ASRTranscriber;
  private readonly ruleExtractor: RuleBasedFeatureExtractor;
  private readonly logger: ILogger;
  private readonly maxTurns: number;
  private client: any = null;

  // Persistent LLM conversation
  private messages: Array<{ role: string; content: string }> = [];
  private language: string;
  private context: { myCallsign?: string; frequency?: number; mode?: string; knownCallsigns?: string[] } = {};

  constructor(config: ChainedConversationProcessorConfig) {
    this.config = config;
    this.asr = config.asr;
    this.ruleExtractor = new RuleBasedFeatureExtractor();
    this.language = config.language ?? 'zh';
    this.maxTurns = config.maxConversationTurns ?? 30;
    this.logger = createLogger('ChainedConversation', config.logger);
    if (config.myCallsign) this.context.myCallsign = config.myCallsign;
  }

  async initialize(): Promise<void> {
    await this.asr.initialize();

    const { default: OpenAI } = await import('openai');
    this.client = new OpenAI({
      apiKey: this.config.llmApiKey,
      baseURL: this.config.llmBaseURL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    });

    this.resetConversation();
    this.logger.info('initialized', {
      asr: this.asr.name ?? 'asr',
      llm: this.config.llmModel ?? 'qwen3-omni-flash',
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
    if (update.frequency !== undefined) this.context.frequency = update.frequency;
    if (update.mode !== undefined) this.context.mode = update.mode;
    if (update.myCallsign !== undefined) this.context.myCallsign = update.myCallsign;
    if (update.knownCallsigns) {
      const existing = new Set(this.context.knownCallsigns ?? []);
      for (const cs of update.knownCallsigns) existing.add(cs);
      this.context.knownCallsigns = [...existing];
    }
  }

  reset(): void {
    this.resetConversation();
    this.context.knownCallsigns = [];
    this.logger.info('conversation reset');
  }

  async dispose(): Promise<void> {
    await this.asr.dispose();
    this.messages = [];
    this.client = null;
  }

  // ─── LLM Conversation ────────────────────────────────────────

  private async extractWithConversation(asrText: string): Promise<TurnFeatures> {
    if (!this.client) return { ...EMPTY_FEATURES };

    // Build user message: just the ASR text + optional context hints
    let userContent = asrText;
    const hints: string[] = [];
    if (this.context.knownCallsigns?.length) {
      hints.push(`[已知电台: ${this.context.knownCallsigns.join(', ')}]`);
    }
    if (this.context.frequency) {
      hints.push(`[${(this.context.frequency / 1e6).toFixed(3)} MHz ${this.context.mode ?? ''}]`);
    }
    if (hints.length > 0) {
      userContent = hints.join(' ') + '\n' + asrText;
    }

    this.messages.push({ role: 'user', content: userContent });

    try {
      const model = this.config.llmModel ?? 'qwen3-omni-flash';
      const response = await this.client.chat.completions.create({
        model,
        messages: this.messages,
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

      // Add assistant response to maintain conversation
      this.messages.push({ role: 'assistant', content: responseText });
      this.trimMessages();

      if (!responseText.trim()) return { ...EMPTY_FEATURES };

      this.logger.debug('LLM response', responseText);
      return parseLLMResponse(responseText, undefined, this.logger);
    } catch (err) {
      // Remove failed user message
      this.messages.pop();
      this.logger.warn('LLM extraction failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return { ...EMPTY_FEATURES };
    }
  }

  private resetConversation(): void {
    const prompt = this.language === 'zh' ? SYSTEM_PROMPT_ZH : SYSTEM_PROMPT_EN;
    this.messages = [{ role: 'system', content: prompt }];
  }

  private trimMessages(): void {
    const maxMessages = 1 + this.maxTurns * 2;
    if (this.messages.length > maxMessages) {
      const system = this.messages[0];
      const recent = this.messages.slice(-(maxMessages - 1));
      this.messages = [system, ...recent];
      this.logger.debug('conversation trimmed', { messageCount: this.messages.length });
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
