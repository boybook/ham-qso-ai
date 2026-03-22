import type { IASRProvider, ILLMProvider } from './providers.js';
import type { SessionMetadata } from './audio.js';
import type { ILogger } from '../utils/logger.js';
import type { IFeatureExtractor } from '../extraction/FeatureExtractor.js';
import type { IVAD } from '../segmentation/types.js';

/**
 * Configuration for the QSO pipeline.
 *
 * Every processing stage is pluggable: provide your own implementation
 * or use the built-in defaults.
 */
export interface QSOPipelineConfig {
  /** ASR provider configuration (required) */
  asr: {
    primary: IASRProvider;
    fallback?: IASRProvider;
  };

  /** LLM provider (optional, enables LLM-based extraction and field completion) */
  llm?: {
    provider: ILLMProvider;
  };

  /** Session metadata (required) */
  session: SessionMetadata;

  /**
   * Feature extractor implementation.
   * Default: RuleBasedFeatureExtractor
   */
  extractor?: IFeatureExtractor;

  /**
   * Voice activity detector / segmenter implementation.
   * Default: EnergyVAD
   */
  segmenter?: IVAD;

  /** VAD configuration (only used if segmenter is not provided) */
  vad?: {
    energyThreshold?: number;
    minSpeechDuration?: number;
    silenceTimeout?: number;
  };

  /** Silence timeout in ms — no activity triggers HOLD or CLOSE (default 15000) */
  silenceTimeout?: number;

  /** Hold timeout in ms — HOLD state times out to CLOSED (default 120000) */
  holdTimeout?: number;

  /** Logger instance (uses console by default) */
  logger?: ILogger;
}
