import type { IASRProvider, ASRResult, ASROptions } from '../../types/providers.js';
import { encodeWav } from '../../utils/audio-utils.js';
import { createLogger, type ILogger } from '../../utils/logger.js';

/**
 * Configuration for Qwen3-ASR Provider.
 */
export interface Qwen3ASRConfig {
  /** DashScope API key */
  apiKey: string;
  /**
   * Model to use:
   * - 'qwen3-asr-flash': Dedicated ASR model, fast, no prompt support
   * - 'qwen3-omni-flash': Multimodal LLM, supports system prompt for context-aware transcription
   * Default: 'qwen3-asr-flash'
   */
  model?: string;
  /** Base URL (default: 'https://dashscope.aliyuncs.com/compatible-mode/v1') */
  baseURL?: string;
  /** Logger */
  logger?: ILogger;
}

/**
 * Alibaba Qwen3-ASR provider.
 *
 * Uses OpenAI-compatible API on DashScope/Bailian platform.
 * qwen3-asr-flash: optimized for Chinese + multilingual, supports
 * low SNR, dialects, and noisy audio — ideal for radio communications.
 */
export class Qwen3ASRProvider implements IASRProvider {
  readonly name = 'qwen3-asr';
  private readonly config: Qwen3ASRConfig;
  private readonly logger: ILogger;
  private client: any = null;

  constructor(config: Qwen3ASRConfig) {
    this.config = config;
    this.logger = createLogger('Qwen3ASR', config.logger);
  }

  async initialize(): Promise<void> {
    try {
      const { default: OpenAI } = await import('openai');
      this.client = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseURL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      });
      this.logger.info('initialized', { model: this.config.model ?? 'qwen3-asr-flash' });
    } catch (err) {
      throw new Error(
        'Failed to initialize Qwen3ASRProvider. Make sure the "openai" package is installed.'
      );
    }
  }

  async transcribe(
    audio: Float32Array,
    sampleRate: number,
    options?: ASROptions,
  ): Promise<ASRResult> {
    if (!this.client) {
      throw new Error('Qwen3ASRProvider not initialized. Call initialize() first.');
    }

    // Encode audio to WAV, then to base64 data URI
    const wavBuffer = encodeWav(audio, sampleRate);
    const base64Audio = Buffer.from(wavBuffer).toString('base64');
    const audioDataUri = `data:audio/wav;base64,${base64Audio}`;

    const model = this.config.model ?? 'qwen3-asr-flash';

    // Build asr_options
    const asrOptions: Record<string, unknown> = {
      enable_itn: true,
    };
    if (options?.language) {
      asrOptions.language = options.language;
    }

    const isOmni = model.includes('omni');
    const messages: any[] = [];

    if (isOmni && options?.prompt) {
      // qwen3-omni-flash: full LLM that supports system prompt + audio
      messages.push({ role: 'system', content: options.prompt });
      messages.push({
        role: 'user',
        content: [
          { type: 'input_audio', input_audio: { data: audioDataUri } },
          { type: 'text', text: '请准确转录以上音频内容。' },
        ],
      });
    } else {
      // qwen3-asr-flash: dedicated ASR, no text input supported
      messages.push({
        role: 'user',
        content: [
          { type: 'input_audio', input_audio: { data: audioDataUri } },
        ],
      });
    }

    const requestParams: Record<string, unknown> = {
      model,
      messages,
      stream: isOmni ? true : false, // Omni requires streaming
    };

    // ASR-specific options (only for dedicated ASR models)
    if (!isOmni) {
      Object.assign(requestParams, { asr_options: asrOptions });
    }

    // Omni models: disable thinking mode for speed (must use extra_body)
    if (isOmni) {
      requestParams.extra_body = { enable_thinking: false };
    }

    try {
      let text = '';

      if (isOmni) {
        // Streaming response — collect all chunks
        const stream = await this.client.chat.completions.create(requestParams) as any;
        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) text += delta;
        }
      } else {
        const response = await this.client.chat.completions.create(requestParams) as any;
        text = response.choices?.[0]?.message?.content ?? '';
      }

      return {
        text: typeof text === 'string' ? text : '',
        confidence: 0.90,
        language: options?.language,
        provider: this.name,
      };
    } catch (err) {
      this.logger.error('transcription failed', err);
      throw err;
    }
  }

  async dispose(): Promise<void> {
    this.client = null;
  }
}
