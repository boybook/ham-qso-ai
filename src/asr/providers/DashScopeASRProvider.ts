import type { IASRProvider, ASRResult, ASROptions } from '../../types/providers.js';
import { encodeWav } from '../../utils/audio-utils.js';
import { createLogger, type ILogger } from '../../utils/logger.js';

/**
 * Configuration for DashScope ASR Provider.
 */
export interface DashScopeASRConfig {
  /** DashScope API key */
  apiKey: string;
  /** Model (default: 'paraformer-realtime-v2') */
  model?: string;
  /** Hot words to boost recognition (e.g., callsigns) */
  hotWords?: string[];
  /** API base URL */
  baseURL?: string;
  /** Logger */
  logger?: ILogger;
}

/**
 * Alibaba DashScope Paraformer ASR provider.
 *
 * Uses the DashScope REST API for file-based transcription.
 * Key advantage: supports hot words for boosting callsign recognition.
 */
export class DashScopeASRProvider implements IASRProvider {
  readonly name = 'dashscope-paraformer';
  private readonly config: DashScopeASRConfig;
  private readonly logger: ILogger;
  private readonly baseURL: string;

  constructor(config: DashScopeASRConfig) {
    this.config = config;
    this.logger = createLogger('DashScopeASR', config.logger);
    this.baseURL = config.baseURL ?? 'https://dashscope.aliyuncs.com/api/v1';
  }

  async initialize(): Promise<void> {
    if (!this.config.apiKey) {
      throw new Error('DashScope API key is required');
    }
    this.logger.info('initialized', { model: this.config.model ?? 'paraformer-realtime-v2' });
  }

  async transcribe(
    audio: Float32Array,
    sampleRate: number,
    options?: ASROptions,
  ): Promise<ASRResult> {
    const wavBuffer = encodeWav(audio, sampleRate);
    const model = this.config.model ?? 'paraformer-realtime-v2';

    // Build request body for DashScope file transcription API
    const requestBody: Record<string, unknown> = {
      model,
      input: {
        // Base64 encode the WAV for inline submission
        audio: Buffer.from(wavBuffer).toString('base64'),
        format: 'wav',
        sample_rate: sampleRate,
      },
      parameters: {
        language_hints: options?.language ? [options.language] : undefined,
      },
    };

    // Add hot words if configured
    const hotWords = options?.hotWords ?? this.config.hotWords;
    if (hotWords && hotWords.length > 0) {
      (requestBody.parameters as Record<string, unknown>).hotwords = hotWords.join(',');
    }

    try {
      const response = await fetch(
        `${this.baseURL}/services/asr/transcription`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DashScope ASR request failed: ${response.status} ${errorText}`);
      }

      const data = await response.json() as DashScopeResponse;

      const text = data.output?.text ?? data.output?.sentence?.text ?? '';
      const confidence = data.output?.sentence?.confidence ?? 0.85;

      return {
        text,
        confidence,
        language: options?.language,
        words: data.output?.sentence?.words?.map((w: any) => ({
          word: w.text,
          start: w.begin_time,
          end: w.end_time,
          confidence: w.confidence ?? 0.85,
        })),
        provider: this.name,
      };
    } catch (err) {
      this.logger.error('transcription failed', err);
      throw err;
    }
  }

  async dispose(): Promise<void> {
    // No persistent connections to clean up
  }
}

interface DashScopeResponse {
  output?: {
    text?: string;
    sentence?: {
      text: string;
      confidence: number;
      words?: Array<{
        text: string;
        begin_time: number;
        end_time: number;
        confidence?: number;
      }>;
    };
  };
}
