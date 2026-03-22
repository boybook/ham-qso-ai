import type { IASRProvider, ASRResult, ASROptions } from '../types/providers.js';
import { createLogger, type ILogger } from '../utils/logger.js';

/**
 * ASR Manager dispatches transcription to the primary provider,
 * falling back to secondary if the primary fails.
 */
export class ASRManager {
  private readonly primary: IASRProvider;
  private readonly fallback: IASRProvider | null;
  private readonly logger: ILogger;
  private readonly minAudioDurationMs: number;

  constructor(options: {
    primary: IASRProvider;
    fallback?: IASRProvider;
    logger?: ILogger;
    /** Minimum audio duration in ms to attempt transcription (default 500) */
    minAudioDurationMs?: number;
  }) {
    this.primary = options.primary;
    this.fallback = options.fallback ?? null;
    this.logger = createLogger('ASRManager', options.logger);
    this.minAudioDurationMs = options.minAudioDurationMs ?? 500;
  }

  /**
   * Initialize all providers.
   */
  async initialize(): Promise<void> {
    await this.primary.initialize();
    if (this.fallback) {
      await this.fallback.initialize();
    }
    this.logger.info('initialized', {
      primary: this.primary.name,
      fallback: this.fallback?.name ?? 'none',
    });
  }

  /**
   * Transcribe audio. Uses primary provider, falls back if it fails.
   * Returns null if audio is too short.
   */
  async transcribe(
    audio: Float32Array,
    sampleRate: number,
    options?: ASROptions,
  ): Promise<ASRResult | null> {
    // Skip very short audio
    const durationMs = (audio.length / sampleRate) * 1000;
    if (durationMs < this.minAudioDurationMs) {
      this.logger.debug('skipping short audio', { durationMs });
      return null;
    }

    // Try primary
    try {
      const result = await this.primary.transcribe(audio, sampleRate, options);
      return result;
    } catch (err) {
      this.logger.warn('primary ASR failed, trying fallback', {
        provider: this.primary.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Try fallback
    if (this.fallback) {
      try {
        const result = await this.fallback.transcribe(audio, sampleRate, options);
        return result;
      } catch (err) {
        this.logger.error('fallback ASR also failed', {
          provider: this.fallback.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return null;
  }

  /**
   * Dispose all providers.
   */
  async dispose(): Promise<void> {
    await this.primary.dispose();
    if (this.fallback) {
      await this.fallback.dispose();
    }
  }
}
