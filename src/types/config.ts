import type { IASRProvider, ILLMProvider, ITurnProcessor } from './providers.js';
import type { SessionMetadata } from './audio.js';
import type { ILogger } from '../utils/logger.js';
import type { IFeatureExtractor } from '../extraction/FeatureExtractor.js';
import type { IVAD } from '../segmentation/types.js';

/**
 * Configuration for the QSO pipeline.
 *
 * Two modes of operation:
 *
 * 1. **Unified processor** (recommended): Set `processor` to an ITurnProcessor
 *    implementation. Handles ASR + extraction in one step. Use createPipeline()
 *    factory for the simplest setup.
 *
 * 2. **Legacy mode**: Set `asr` (and optionally `extractor`/`llm`) for the
 *    traditional ASR → FeatureExtractor chain. Automatically wrapped into
 *    a ChainedTurnProcessor internally.
 */
export interface QSOPipelineConfig {
  /**
   * Unified turn processor (recommended).
   * When set, replaces the asr + extractor chain.
   */
  processor?: ITurnProcessor;

  /** ASR provider configuration (required in legacy mode, ignored if processor is set) */
  asr?: {
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
