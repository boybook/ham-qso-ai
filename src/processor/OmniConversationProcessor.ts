import type { ITurnProcessor, TurnProcessorResult, ContextUpdate } from '../types/providers.js';
import { encodeWav } from '../utils/audio-utils.js';
import { createLogger, type ILogger } from '../utils/logger.js';
import { EMPTY_FEATURES, parseLLMResponse, extractTextFromResponse } from '../extraction/llm-response-parser.js';

/**
 * Configuration for OmniConversationProcessor.
 */
export interface OmniConversationProcessorConfig {
  /** API key (DashScope or OpenAI) */
  apiKey: string;
  /** Model name (default: 'qwen3-omni-flash') */
  model?: string;
  /** Base URL (default: DashScope Beijing) */
  baseURL?: string;
  /** Max message pairs in conversation before trimming (default: 20 = ~20 turns) */
  maxTurns?: number;
  /** Logger */
  logger?: ILogger;
}

// ─── System Prompt ──────────────────────────────────────────────

const SYSTEM_PROMPT_ZH = `你是业余无线电短波通联录音的实时转录系统。你会逐段收到音频，对每段音频输出一个 JSON。

规则：
- 只输出 JSON，禁止输出任何解释、分析、列表或额外文字
- 如果音频是噪音、静音或听不清，只返回 {"text":""}
- 绝对不要编造内容、补充字母表或输出模板文字
- 只转录你实际听到的语音内容
- text 字段必须使用音频的原始语言（中文通联用中文转录，英文通联用英文转录）
- 呼号和 NATO 音标保持原始形式（如 "Bravo Hotel 8 November Echo" 原样写出）

呼号格式：前缀(1-3字符)+数字(1位)+后缀(1-4字母)。
中国前缀：BA/BD/BG/BH/BY 等，数字为分区（七区、八区等）。
通联中通常有两个电台互相通话，请提取你听到的所有呼号。
使用 NATO 音标逐字母拼读时，需要还原为呼号（如 Bravo Hotel 8 → BH8...）。

信号报告：五九(59)、五九加(59+)。术语：抄收、拷贝、Over、73、七三、再见、QTH。

JSON 格式（cs/rst/loc 中只填实际听到的，没有则省略该字段）：
{"text":"原始语言转录","cs":[{"v":"呼号","c":0.9}],"rst":[{"v":"59","c":0.8}],"loc":[{"v":"地名"}],"close":false,"cont":false,"start":false}

参考之前轮次帮助理解当前音频。只提取当前段实际听到的内容。`;

const SYSTEM_PROMPT_EN = `You are a real-time amateur radio QSO transcription system. You receive audio segments one at a time and output one JSON per segment.

Rules:
- Output JSON only. No explanations, no lists, no template text.
- If audio is noise, silence, or unintelligible, return {"text":""}.
- Never fabricate content or output placeholder text.
- Only transcribe what you actually hear, in the original language.

Callsign format: PREFIX(1-3 chars) + DIGIT(1) + SUFFIX(1-4 letters).
Decode NATO phonetics letter by letter. A QSO has TWO callsigns — extract all.
Signal reports: "five nine"=59. Terms: CQ, copy, roger, 73, over, QTH.

JSON format (omit cs/rst/loc if not heard):
{"text":"actual transcription","cs":[{"v":"CALLSIGN","c":0.9}],"rst":[{"v":"59","c":0.8}],"loc":[{"v":"place"}],"close":false,"cont":false,"start":false}

Reference previous turns for context. Only extract from the CURRENT audio.`;

/**
 * Omni Conversation Processor.
 *
 * Maintains a persistent multi-turn conversation with a multimodal LLM.
 * Each audio turn is a new user message in the ongoing conversation,
 * so the LLM naturally retains context from all previous turns
 * (including its own previous analysis).
 *
 * This eliminates the need for manual context window management —
 * the conversation IS the context.
 */
export class OmniConversationProcessor implements ITurnProcessor {
  readonly name = 'omni-conversation';
  private readonly config: OmniConversationProcessorConfig;
  private readonly logger: ILogger;
  private readonly maxTurns: number;
  private client: any = null;

  // Persistent conversation state
  private messages: Array<{ role: string; content: any }> = [];
  private language: string = 'zh';
  private myCallsign: string = 'LISTENER';

  constructor(config: OmniConversationProcessorConfig) {
    this.config = config;
    this.maxTurns = config.maxTurns ?? 20;
    this.logger = createLogger('OmniConversation', config.logger);
  }

  async initialize(): Promise<void> {
    try {
      const { default: OpenAI } = await import('openai');
      this.client = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseURL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      });
    } catch {
      throw new Error('Failed to initialize. Install "openai" package: npm install openai');
    }

    // Initialize conversation with system prompt
    this.resetConversation();
    this.logger.info('initialized', { model: this.config.model ?? 'qwen3-omni-flash' });
  }

  async processTurn(audio: Float32Array, sampleRate: number): Promise<TurnProcessorResult> {
    if (!this.client) {
      throw new Error('Not initialized. Call initialize() first.');
    }

    // Encode audio to base64 data URI
    const wavBuffer = encodeWav(audio, sampleRate);
    const base64Audio = Buffer.from(wavBuffer).toString('base64');
    const audioDataUri = `data:audio/wav;base64,${base64Audio}`;

    // Build user message with audio
    const userMessage = {
      role: 'user',
      content: [
        { type: 'input_audio', input_audio: { data: audioDataUri } },
      ],
    };
    this.messages.push(userMessage);

    try {
      // Stream the response
      const model = this.config.model ?? 'qwen3-omni-flash';
      const stream = await this.client.chat.completions.create({
        model,
        messages: this.messages,
        stream: true,
        enable_thinking: false,
      });

      let responseText = '';
      for await (const chunk of stream as any) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) responseText += delta;
      }

      // Add assistant response to conversation (maintains context)
      this.messages.push({ role: 'assistant', content: responseText });

      // Trim conversation if too long
      this.trimMessages();

      // Parse the response
      if (!responseText.trim()) {
        return { text: '', confidence: 0, features: { ...EMPTY_FEATURES }, provider: this.name };
      }

      const text = extractTextFromResponse(responseText);

      // Filter hallucinated template responses (e.g., NATO alphabet list, or
      // model repeating the system prompt). These have very long text but no
      // actual radio content.
      if (this.isHallucinatedResponse(text, responseText)) {
        this.logger.debug('filtered hallucinated response', { textLength: text.length });
        // Replace the hallucinated assistant message with empty
        this.messages[this.messages.length - 1] = { role: 'assistant', content: '{"text":""}' };
        return { text: '', confidence: 0, features: { ...EMPTY_FEATURES }, provider: this.name };
      }
      const features = parseLLMResponse(responseText, undefined, this.logger);

      this.logger.debug('turn processed', {
        textLength: text.length,
        callsigns: features.callsignCandidates.length,
        messageCount: this.messages.length,
      });

      return { text, confidence: 0.90, features, provider: this.name };
    } catch (err) {
      // Remove the failed user message to keep conversation consistent
      this.messages.pop();
      this.logger.error('processTurn failed', err);
      return { text: '', confidence: 0, features: { ...EMPTY_FEATURES }, provider: this.name };
    }
  }

  updateContext(update: ContextUpdate): void {
    if (update.myCallsign !== undefined) this.myCallsign = update.myCallsign;
    if (update.language !== undefined) this.language = update.language;

    // Inject metadata updates as a brief system note in the conversation
    const notes: string[] = [];
    if (update.frequency !== undefined) {
      notes.push(`Frequency: ${(update.frequency / 1_000_000).toFixed(3)} MHz`);
    }
    if (update.mode !== undefined) {
      notes.push(`Mode: ${update.mode}`);
    }
    if (update.knownCallsigns?.length) {
      notes.push(`Known stations: ${update.knownCallsigns.join(', ')}`);
    }

    // Only inject if there's meaningful metadata to share
    // Use a user message with text (not audio) as a context hint
    if (notes.length > 0) {
      this.messages.push({
        role: 'user',
        content: `[Context update] ${notes.join('. ')}`,
      });
      this.messages.push({
        role: 'assistant',
        content: '{"text":""}',
      });
    }
  }

  reset(): void {
    this.resetConversation();
    this.logger.info('conversation reset');
  }

  async dispose(): Promise<void> {
    this.messages = [];
    this.client = null;
  }

  /**
   * Detect hallucinated responses — model outputs template text instead
   * of actual transcription when audio is noise/silence.
   */
  private isHallucinatedResponse(text: string, rawResponse: string): boolean {
    // NATO alphabet list hallucination
    if (text.includes('Alpha') && text.includes('Bravo') && text.includes('Charlie')
      && text.includes('Zulu')) {
      return true;
    }
    // Model explaining why it can't transcribe (Chinese)
    if (rawResponse.includes('无法转录') || rawResponse.includes('无法准确')
      || rawResponse.includes('不属于') || rawResponse.includes('不符合')) {
      return true;
    }
    // Response is way too long for a radio turn (likely analysis/explanation)
    if (rawResponse.length > 500 && !text) {
      return true;
    }
    return false;
  }

  /**
   * Reset conversation to initial state (system prompt only).
   */
  private resetConversation(): void {
    const systemPrompt = this.language === 'zh' ? SYSTEM_PROMPT_ZH : SYSTEM_PROMPT_EN;
    this.messages = [{ role: 'system', content: systemPrompt }];
  }

  /**
   * Trim conversation to keep within maxTurns.
   * Preserves system message + most recent turn pairs.
   */
  private trimMessages(): void {
    // Each turn = 1 user + 1 assistant = 2 messages
    // Plus 1 system message
    const maxMessages = 1 + this.maxTurns * 2;

    if (this.messages.length > maxMessages) {
      const system = this.messages[0];
      const recent = this.messages.slice(-(maxMessages - 1));
      this.messages = [system, ...recent];
      this.logger.debug('conversation trimmed', { messageCount: this.messages.length });
    }
  }
}
