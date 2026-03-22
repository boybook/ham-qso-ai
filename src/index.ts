// Types
export type {
  AudioChunk,
  RadioMetadata,
  SessionMetadata,
} from './types/audio.js';

export type {
  Turn,
  ProcessedTurn,
  TurnFeatures,
} from './types/turn.js';

export type {
  QSODraft,
  QSODraftStatus,
  ResolvedField,
  FieldCandidate,
} from './types/qso.js';

export type {
  IASRProvider,
  ASRResult,
  ASROptions,
  ILLMProvider,
  LLMResult,
  LLMOptions,
} from './types/providers.js';

export type {
  QSOPipelineConfig,
} from './types/config.js';

export type {
  TraceEntry,
} from './types/trace.js';

export type {
  QSOCandidateStatus,
  QSOCandidateInfo,
} from './types/candidate.js';

// Interfaces (pluggable stage contracts)
export type { IFeatureExtractor, ExtractionContext } from './extraction/FeatureExtractor.js';
export type { IVAD, VADConfig } from './segmentation/types.js';
export type { QSOState } from './session/QSOStateMachine.js';

// Utils
export {
  isValidCallsign,
  isValidGrid,
  normalizeCallsign,
} from './utils/ham-utils.js';

// === Pluggable Stage Implementations ===

// Extraction (IFeatureExtractor implementations)
export { RuleBasedFeatureExtractor } from './extraction/FeatureExtractor.js';
export { LLMFeatureExtractor } from './extraction/LLMFeatureExtractor.js';
export { HybridFeatureExtractor } from './extraction/HybridFeatureExtractor.js';

// Extraction internals (for custom extractors)
export { PhoneticAlphabetDecoder } from './extraction/PhoneticAlphabetDecoder.js';
export { CallsignExtractor } from './extraction/CallsignExtractor.js';
export { RSTExtractor } from './extraction/RSTExtractor.js';
export { ClosingDetector } from './extraction/ClosingDetector.js';

// Segmentation (IVAD implementations)
export { EnergyVAD } from './segmentation/EnergyVAD.js';

// Resolver
export { VotingFieldResolver } from './resolver/FieldCandidateResolver.js';
export { CandidatePool } from './resolver/CandidatePool.js';
export { ConfidenceScorer } from './resolver/ConfidenceScorer.js';

// ASR (IASRProvider implementations)
export { ASRManager } from './asr/ASRManager.js';
export { NullASRProvider } from './asr/providers/NullProvider.js';
export { WhisperProvider } from './asr/providers/WhisperProvider.js';
export { DashScopeASRProvider } from './asr/providers/DashScopeASRProvider.js';

// LLM (ILLMProvider implementations)
export { LLMManager } from './llm/LLMManager.js';
export { NullLLMProvider } from './llm/providers/NullProvider.js';
export { OpenAICompatibleProvider } from './llm/providers/OpenAICompatibleProvider.js';

// Session
export { QSOSessionEngine } from './session/QSOSessionEngine.js';
export { QSOCandidate } from './session/QSOCandidate.js';
export { QSOCandidateManager } from './session/QSOCandidateManager.js';
export { getFrequencyChangeThreshold } from './session/QSOStateMachine.js';

// Pipeline
export { QSOPipeline } from './pipeline/QSOPipeline.js';
export type { QSOPipelineEvents } from './pipeline/QSOPipeline.js';

// Output
export { QSODraftEmitter } from './output/QSODraftEmitter.js';
