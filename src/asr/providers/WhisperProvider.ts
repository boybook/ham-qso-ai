import type { IASRProvider, ASRResult, ASROptions } from '../../types/providers.js';
import { encodeWav } from '../../utils/audio-utils.js';
import { createLogger, type ILogger } from '../../utils/logger.js';

/**
 * Configuration for WhisperProvider.
 */
export interface WhisperProviderConfig {
  /** OpenAI API key */
  apiKey: string;
  /** Model to use (default: 'whisper-1') */
  model?: string;
  /** Base URL (default: 'https://api.openai.com/v1') */
  baseURL?: string;
  /** Logger */
  logger?: ILogger;
}

/**
 * OpenAI Whisper / gpt-4o-transcribe ASR provider.
 * Uses the OpenAI SDK to transcribe audio.
 */
export class WhisperProvider implements IASRProvider {
  readonly name = 'whisper';
  private readonly config: WhisperProviderConfig;
  private client: any = null; // OpenAI client (lazy loaded)
  private readonly logger: ILogger;

  constructor(config: WhisperProviderConfig) {
    this.config = config;
    this.logger = createLogger('WhisperProvider', config.logger);
  }

  async initialize(): Promise<void> {
    try {
      // Dynamic import to avoid hard dependency on openai package
      const { default: OpenAI } = await import('openai');
      this.client = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseURL,
      });
      this.logger.info('initialized');
    } catch (err) {
      throw new Error(
        'Failed to initialize WhisperProvider. Make sure the "openai" package is installed: npm install openai'
      );
    }
  }

  async transcribe(
    audio: Float32Array,
    sampleRate: number,
    options?: ASROptions,
  ): Promise<ASRResult> {
    if (!this.client) {
      throw new Error('WhisperProvider not initialized. Call initialize() first.');
    }

    // Encode audio to WAV
    const wavBuffer = encodeWav(audio, sampleRate);

    // Create a File-like object from the buffer
    const file = new File([wavBuffer], 'audio.wav', { type: 'audio/wav' });

    const model = this.config.model ?? 'whisper-1';
    // gpt-4o-transcribe doesn't support verbose_json, use json instead
    const isGpt4oTranscribe = model.startsWith('gpt-4o');
    const requestParams: Record<string, unknown> = {
      file,
      model,
      response_format: isGpt4oTranscribe ? 'json' : 'verbose_json',
    };

    if (options?.language) {
      requestParams.language = options.language;
    }

    if (options?.prompt) {
      requestParams.prompt = options.prompt;
    }

    try {
      const response = await this.client.audio.transcriptions.create(requestParams);

      return {
        text: response.text ?? '',
        confidence: 0.85, // Whisper API doesn't return confidence; use reasonable default
        language: response.language,
        words: response.words?.map((w: any) => ({
          word: w.word,
          start: Math.round(w.start * 1000),
          end: Math.round(w.end * 1000),
          confidence: 1.0,
        })),
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
