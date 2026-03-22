/**
 * Patterns for detecting QSO closing signals.
 */

export interface ClosingPattern {
  pattern: RegExp;
  type: string;
  /** Strength of closing signal (0-1). Higher = stronger closing indicator. */
  strength: number;
}

/**
 * QSO closing signal patterns, ordered by strength.
 */
export const CLOSING_PATTERNS: ClosingPattern[] = [
  // Strong closing signals
  { pattern: /\b73\b/g, type: 'farewell', strength: 0.9 },
  { pattern: /\bseventy\s*(?:-\s*)?three\b/gi, type: 'farewell', strength: 0.9 },
  { pattern: /\bseven\s+three\b/gi, type: 'farewell', strength: 0.9 },
  { pattern: /\bgood\s+dx\b/gi, type: 'farewell', strength: 0.85 },
  { pattern: /\b88\b/g, type: 'farewell', strength: 0.85 },

  // Moderate closing signals
  { pattern: /\bqsl\b/gi, type: 'confirmation', strength: 0.6 },
  { pattern: /\bthanks?\s+for\s+the\s+(?:qso|contact|call)\b/gi, type: 'thanks', strength: 0.8 },
  { pattern: /\bnice\s+(?:to\s+)?(?:meet|talk|chat)\b/gi, type: 'thanks', strength: 0.6 },
  { pattern: /\bgood\s+luck\b/gi, type: 'farewell', strength: 0.6 },
  { pattern: /\btake\s+care\b/gi, type: 'farewell', strength: 0.6 },
  { pattern: /\bhave\s+a\s+good\s+(?:one|day|evening|night)\b/gi, type: 'farewell', strength: 0.6 },

  // Weak closing signals (could appear mid-QSO)
  { pattern: /\bback\s+to\s+you\b/gi, type: 'handoff', strength: 0.3 },
  { pattern: /\bover\s+and\s+out\b/gi, type: 'farewell', strength: 0.85 },
  { pattern: /\bgoing\s+qrt\b/gi, type: 'closing', strength: 0.9 },
  { pattern: /\bclear(?:ing)?\b/gi, type: 'closing', strength: 0.5 },

  // Chinese closing signals
  { pattern: /七[十]?三/g, type: 'farewell', strength: 0.9 },
  { pattern: /再见/g, type: 'farewell', strength: 0.8 },
  { pattern: /谢谢[联通]?[络联]?/g, type: 'thanks', strength: 0.8 },
  { pattern: /感谢(?:联络|通联|呼叫)/g, type: 'thanks', strength: 0.8 },
  { pattern: /祝?好运/g, type: 'farewell', strength: 0.6 },
  { pattern: /下次再[见联]/g, type: 'farewell', strength: 0.7 },
  { pattern: /关机/g, type: 'closing', strength: 0.9 },
  { pattern: /收台/g, type: 'closing', strength: 0.85 },
];

/**
 * QSO continuation signals (indicates QSO is ongoing, NOT closing).
 */
export interface ContinuationPattern {
  pattern: RegExp;
  type: string;
}

export const CONTINUATION_PATTERNS: ContinuationPattern[] = [
  { pattern: /\broger\b/gi, type: 'acknowledgment' },
  { pattern: /\bcopy\b/gi, type: 'acknowledgment' },
  { pattern: /\bgo\s+ahead\b/gi, type: 'invitation' },
  { pattern: /\bover\b/gi, type: 'handoff' },
  { pattern: /\bback\s+to\s+you\b/gi, type: 'handoff' },
  { pattern: /\byour\s+turn\b/gi, type: 'handoff' },
  // Chinese
  { pattern: /收到/g, type: 'acknowledgment' },
  { pattern: /抄收/g, type: 'acknowledgment' },
  { pattern: /明白/g, type: 'acknowledgment' },
  { pattern: /请[讲说回]?/g, type: 'invitation' },
  { pattern: /你说/g, type: 'invitation' },
];

/**
 * QSO start signals.
 */
export interface StartPattern {
  pattern: RegExp;
  type: string;
}

export const START_PATTERNS: StartPattern[] = [
  { pattern: /\bcq\s+cq\b/gi, type: 'cq' },
  { pattern: /\bcq\s+de\b/gi, type: 'cq' },
  { pattern: /\bcq\b/gi, type: 'cq' },
  { pattern: /\bqrz\b/gi, type: 'qrz' },
  { pattern: /\bcalling\b/gi, type: 'calling' },
  // Chinese
  { pattern: /呼叫/g, type: 'calling' },
  { pattern: /有人吗/g, type: 'cq' },
];
