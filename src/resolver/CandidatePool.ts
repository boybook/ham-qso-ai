import type { FieldCandidate, ResolvedField, FieldSource } from '../types/qso.js';
import { ConfidenceScorer, type ScoringConfig } from './ConfidenceScorer.js';

/**
 * A pool of candidates for a single QSO field.
 *
 * Uses a voting/scoring mechanism instead of last-write-wins.
 * Multiple mentions of the same value accumulate confidence.
 */
export class CandidatePool<T = string> {
  private candidates: FieldCandidate<T>[] = [];
  private readonly scorer: ConfidenceScorer;
  private readonly maxCandidates: number;

  constructor(options?: {
    scoringConfig?: Partial<ScoringConfig>;
    maxCandidates?: number;
  }) {
    this.scorer = new ConfidenceScorer(options?.scoringConfig);
    this.maxCandidates = options?.maxCandidates ?? 50;
  }

  /**
   * Add a candidate to the pool.
   */
  add(candidate: FieldCandidate<T>): void {
    this.candidates.push(candidate);

    // Prune if over limit
    if (this.candidates.length > this.maxCandidates) {
      // Remove oldest low-confidence candidates
      this.candidates.sort((a, b) => b.confidence - a.confidence);
      this.candidates = this.candidates.slice(0, this.maxCandidates);
    }
  }

  /**
   * Add multiple candidates.
   */
  addAll(candidates: FieldCandidate<T>[]): void {
    for (const c of candidates) {
      this.add(c);
    }
  }

  /**
   * Resolve the pool to the best candidate.
   * Returns null if the pool is empty.
   */
  resolve(): ResolvedField<T> | null {
    if (this.candidates.length === 0) return null;

    const scored = this.scorer.score(this.candidates);
    if (scored.length === 0) return null;

    const best = scored[0];

    return {
      value: best.value,
      confidence: best.finalScore,
      source: best.source,
      candidates: scored.map(s => ({
        value: s.value,
        confidence: s.finalScore,
        source: s.source,
      })),
    };
  }

  /**
   * Get all raw candidates in the pool.
   */
  getAll(): FieldCandidate<T>[] {
    return [...this.candidates];
  }

  /**
   * Get the number of candidates.
   */
  get size(): number {
    return this.candidates.length;
  }

  /**
   * Check if the pool is empty.
   */
  get isEmpty(): boolean {
    return this.candidates.length === 0;
  }

  /**
   * Clear all candidates.
   */
  clear(): void {
    this.candidates = [];
  }
}
