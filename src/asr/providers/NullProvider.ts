import type { IASRProvider, ASRResult, ASROptions } from '../../types/providers.js';

/**
 * Configuration for NullASRProvider.
 */
export interface NullProviderConfig {
  /** Fixed text to return for all transcriptions */
  fixedText?: string;
  /** Map of sequential texts to return (cycled) */
  texts?: string[];
  /** Fixed confidence */
  confidence?: number;
}

/**
 * A no-op ASR provider for testing.
 * Returns predefined text instead of actual transcription.
 */
export class NullASRProvider implements IASRProvider {
  readonly name = 'null';
  private readonly config: NullProviderConfig;
  private callIndex = 0;

  constructor(config: NullProviderConfig = {}) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    // No-op
  }

  async transcribe(
    _audio: Float32Array,
    _sampleRate: number,
    _options?: ASROptions,
  ): Promise<ASRResult> {
    let text: string;

    if (this.config.texts && this.config.texts.length > 0) {
      text = this.config.texts[this.callIndex % this.config.texts.length];
      this.callIndex++;
    } else {
      text = this.config.fixedText ?? '';
    }

    return {
      text,
      confidence: this.config.confidence ?? 0.95,
      provider: this.name,
    };
  }

  async dispose(): Promise<void> {
    // No-op
  }
}
