/**
 * Lifecycle status of a QSO candidate.
 */
export type QSOCandidateStatus = 'candidate' | 'active' | 'closed' | 'abandoned';

/**
 * Snapshot information about a QSO candidate (for external consumption).
 */
export interface QSOCandidateInfo {
  /** Unique candidate ID */
  id: string;
  /** Current lifecycle status */
  status: QSOCandidateStatus;
  /** Callsigns involved in this QSO */
  callsigns: string[];
  /** Whether this is the primary tracked candidate */
  isPrimary: boolean;
  /** Creation timestamp */
  createdAt: number;
  /** Last activity timestamp */
  lastActivityAt: number;
  /** Number of turns attributed to this candidate */
  turnCount: number;
  /** Evidence strength (0-1) — how confident we are this is a real QSO */
  evidenceScore: number;
  /** Closing score (0-1) — how likely this QSO has ended */
  closingScore: number;
}
