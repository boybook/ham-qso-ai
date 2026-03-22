import type { ProcessedTurn } from './turn.js';
import type { TraceEntry } from './trace.js';

/**
 * Status of a QSO draft.
 */
export type QSODraftStatus = 'draft' | 'ready' | 'final';

/**
 * A structured QSO draft produced by the pipeline.
 */
export interface QSODraft {
  /** Unique draft ID */
  id: string;
  /** Current status */
  status: QSODraftStatus;
  /** Resolved fields */
  fields: QSOFields;
  /** All turns associated with this QSO */
  turns: ProcessedTurn[];
  /** Decision trace for auditing */
  trace: TraceEntry[];
  /** Creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
}

/**
 * All fields of a QSO log entry.
 */
export interface QSOFields {
  /** Their callsign */
  theirCallsign: ResolvedField<string>;
  /** RST sent */
  rstSent: ResolvedField<string>;
  /** RST received */
  rstReceived: ResolvedField<string>;
  /** Frequency in Hz */
  frequency: ResolvedField<number>;
  /** Operating mode */
  mode: ResolvedField<string>;
  /** QSO start time (ms timestamp) */
  startTime: ResolvedField<number>;
  /** QSO end time (ms timestamp) */
  endTime?: ResolvedField<number>;
  /** Their operator name */
  theirName?: ResolvedField<string>;
  /** Their QTH / location */
  theirQTH?: ResolvedField<string>;
  /** Their grid locator */
  theirGrid?: ResolvedField<string>;
  /** My callsign */
  myCallsign: ResolvedField<string>;
}

/**
 * A resolved field value with confidence and provenance.
 */
export interface ResolvedField<T> {
  /** Best resolved value */
  value: T;
  /** Confidence score 0-1 */
  confidence: number;
  /** Source type */
  source: FieldSource;
  /** All candidates considered (summary, not full FieldCandidate) */
  candidates?: Array<{ value: T; confidence: number; source: FieldSource }>;
}

/**
 * Source type for a field value.
 */
export type FieldSource = 'rule' | 'rule:phonetic' | 'asr' | 'llm' | 'manual' | 'metadata';

/**
 * A candidate value for a QSO field.
 */
export interface FieldCandidate<T = string> {
  /** Candidate value */
  value: T;
  /** Confidence score 0-1 */
  confidence: number;
  /** Source of this candidate */
  source: FieldSource;
  /** Turn ID that produced this candidate */
  sourceTurnId?: string;
  /** Timestamp when this candidate was produced */
  createdAt: number;
  /** Supporting evidence */
  evidence?: string[];
}
