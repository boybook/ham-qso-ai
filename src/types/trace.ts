/**
 * A single entry in the decision trace log.
 */
export interface TraceEntry {
  /** Timestamp in ms */
  timestamp: number;
  /** Who made this decision */
  actor: 'rule' | 'llm' | 'system' | 'manual';
  /** Action taken */
  action: string;
  /** Reasons for the decision */
  reasons: string[];
  /** Affected QSO draft ID */
  qsoId?: string;
  /** Affected field name */
  field?: string;
  /** Associated turn ID */
  turnId?: string;
}
