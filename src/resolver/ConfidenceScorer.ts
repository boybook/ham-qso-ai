import type { FieldCandidate } from '../types/qso.js';

/**
 * Configuration for confidence scoring.
 */
export interface ScoringConfig {
  /** Time decay half-life in ms (older candidates lose weight). Default 60000 (1 min). */
  decayHalfLifeMs: number;
  /** Bonus for repeat mentions of the same value. Default 0.1. */
  repeatBonus: number;
  /** Maximum repeat bonus cap. Default 0.3. */
  maxRepeatBonus: number;
  /** Source weight multipliers. */
  sourceWeights: Record<string, number>;
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  decayHalfLifeMs: 60000,
  repeatBonus: 0.1,
  maxRepeatBonus: 0.3,
  sourceWeights: {
    'manual': 1.5,
    'rule': 1.0,
    'rule:phonetic': 1.0,
    'llm': 0.9,
    'asr': 0.7,
    'metadata': 1.2,
  },
};

/**
 * Scores and ranks field candidates using voting, time decay, and source weighting.
 */
export class ConfidenceScorer {
  private readonly config: ScoringConfig;

  constructor(config?: Partial<ScoringConfig>) {
    this.config = { ...DEFAULT_SCORING_CONFIG, ...config };
  }

  /**
   * Score a set of candidates for the same field and return them sorted by score.
   */
  score<T>(candidates: FieldCandidate<T>[]): Array<FieldCandidate<T> & { finalScore: number }> {
    const now = Date.now();

    // Group by value
    const groups = new Map<string, FieldCandidate<T>[]>();
    for (const c of candidates) {
      const key = String(c.value);
      const group = groups.get(key) ?? [];
      group.push(c);
      groups.set(key, group);
    }

    const scored: Array<FieldCandidate<T> & { finalScore: number }> = [];

    for (const [_key, group] of groups) {
      // Base: highest confidence in group
      const bestCandidate = group.reduce((a, b) => a.confidence > b.confidence ? a : b);
      let score = bestCandidate.confidence;

      // Source weight
      const sourceWeight = this.config.sourceWeights[bestCandidate.source] ?? 1.0;
      score *= sourceWeight;

      // Repeat bonus (multiple mentions of same value)
      const repeatBonus = Math.min(
        (group.length - 1) * this.config.repeatBonus,
        this.config.maxRepeatBonus,
      );
      score += repeatBonus;

      // Time decay: reduce score for older candidates
      const mostRecent = Math.max(...group.map(c => c.createdAt));
      const age = now - mostRecent;
      const decayFactor = Math.pow(0.5, age / this.config.decayHalfLifeMs);
      score *= decayFactor;

      // Clamp
      score = Math.min(1, Math.max(0, score));

      scored.push({
        ...bestCandidate,
        finalScore: score,
      });
    }

    // Sort by score descending
    scored.sort((a, b) => b.finalScore - a.finalScore);
    return scored;
  }
}
