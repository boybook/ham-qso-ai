import type { IASRProvider, ILLMProvider } from './providers.js';
import type { SessionMetadata } from './audio.js';
import type { ILogger } from '../utils/logger.js';
import type { IFeatureExtractor } from '../extraction/FeatureExtractor.js';
import type { IVAD } from '../segmentation/types.js';
import type { IFieldResolver } from '../resolver/FieldCandidateResolver.js';

/**
 * Configuration for the QSO pipeline.
 *
 * Every processing stage is pluggable: provide your own implementation
 * or use the built-in defaults.
 *
 * Defaults:
 * - segmenter: EnergyVAD (local energy-based VAD)
 * - extractor: RuleBasedFeatureExtractor (regex patterns)
 * - resolver: VotingFieldResolver (candidate pool voting)
 */
export interface QSOPipelineConfig {
  /** ASR provider configuration (required) */
  asr: {
    /** Primary ASR provider */
    primary: IASRProvider;
    /** Fallback ASR provider (used when primary fails) */
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
   *
   * Options:
   * - RuleBasedFeatureExtractor: fast, free, offline, regex-based
   * - LLMFeatureExtractor: accurate, multilingual, requires LLM provider
   * - HybridFeatureExtractor: rules first, LLM for gaps
   * - Custom: implement IFeatureExtractor
   */
  extractor?: IFeatureExtractor;

  /**
   * Voice activity detector / segmenter implementation.
   * Default: EnergyVAD
   *
   * Options:
   * - EnergyVAD: built-in energy-based VAD
   * - Custom: implement IVAD interface
   */
  segmenter?: IVAD;

  /**
   * Field resolver implementation.
   * Default: VotingFieldResolver
   *
   * Options:
   * - VotingFieldResolver: candidate pool with voting/decay
   * - Custom: implement IFieldResolver
   */
  resolver?: IFieldResolver;

  /** VAD configuration (only used if segmenter is not provided) */
  vad?: {
    /** Energy threshold for voice detection (0-1, default 0.01) */
    energyThreshold?: number;
    /** Minimum speech duration in ms (default 500) */
    minSpeechDuration?: number;
    /** Silence timeout in ms to end a turn (default 1500) */
    silenceTimeout?: number;
  };

  /** Session timeout in ms before HOLD state (default 300000 = 5 minutes) */
  sessionTimeout?: number;

  /** Logger instance (uses console by default) */
  logger?: ILogger;
}
