import type { FieldCandidate } from './qso.js';

/**
 * A raw turn segment produced by the segmentation layer.
 */
export interface Turn {
  /** Unique turn ID */
  id: string;
  /** Audio direction this turn came from */
  direction: 'rx' | 'tx';
  /** Start time in ms (absolute) */
  startTime: number;
  /** End time in ms (absolute) */
  endTime: number;
  /** Duration in ms */
  duration: number;
  /** Raw PCM audio samples */
  audio: Float32Array;
  /** Sample rate */
  sampleRate: number;
}

/**
 * A turn that has been processed through ASR and feature extraction.
 */
export interface ProcessedTurn extends Turn {
  /** ASR transcription text */
  text: string;
  /** ASR confidence (0-1) */
  asrConfidence: number;
  /** ASR provider that produced this transcription */
  asrProvider: string;
  /** Extracted features */
  features: TurnFeatures;
  /** Inferred speaker callsign (known for TX, inferred for RX) */
  speaker?: string;
  /** Speaker inference confidence (1.0 for TX, lower for RX inference) */
  speakerConfidence?: number;
  /** Whether this turn appears to be an interruption by a third party */
  isInterruption?: boolean;
}

/**
 * Features extracted from a transcribed turn by the rule engine.
 */
export interface TurnFeatures {
  /** Callsign candidates found in this turn */
  callsignCandidates: FieldCandidate<string>[];
  /** RST report candidates */
  rstCandidates: FieldCandidate<string>[];
  /** Name candidates (operator name) */
  nameCandidates: FieldCandidate<string>[];
  /** QTH / location candidates */
  qthCandidates: FieldCandidate<string>[];
  /** Grid locator candidates */
  gridCandidates: FieldCandidate<string>[];
  /** Closing signals detected (73, good DX, etc.) */
  closingSignals: SignalHit[];
  /** Continuation signals (roger, copy, go ahead) */
  continuationSignals: SignalHit[];
  /** QSO start signals (CQ, calling) */
  qsoStartSignals: SignalHit[];
}

/**
 * A detected signal pattern in the text.
 */
export interface SignalHit {
  /** Type of signal */
  type: string;
  /** Matched text */
  matchedText: string;
  /** Position in the original text */
  position: number;
  /** Confidence 0-1 */
  confidence: number;
}
