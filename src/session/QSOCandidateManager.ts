import type { ProcessedTurn } from '../types/turn.js';
import type { QSOCandidateInfo } from '../types/candidate.js';
import { QSOCandidate } from './QSOCandidate.js';

/**
 * Result of routing a turn to a candidate.
 */
export interface RouteTurnResult {
  candidate: QSOCandidate;
  isNew: boolean;
}

/**
 * Manages all active QSO candidates.
 *
 * Replaces the old ShadowSessionManager with a full multi-candidate system
 * where each candidate independently tracks its own turns, field pools, and state.
 */
export class QSOCandidateManager {
  private candidates: Map<string, QSOCandidate> = new Map();
  private primaryId: string | null = null;
  private readonly myCallsign: string;
  private readonly maxCandidates: number;
  private readonly affinityThreshold: number;
  private currentFrequency: number = 0;
  private currentMode: string = '';

  constructor(options: {
    myCallsign: string;
    maxCandidates?: number;
    affinityThreshold?: number;
  }) {
    this.myCallsign = options.myCallsign.toUpperCase();
    this.maxCandidates = options.maxCandidates ?? 5;
    this.affinityThreshold = options.affinityThreshold ?? 0.4;
  }

  /**
   * Route a turn to the best-matching candidate, or create a new one.
   *
   * Logic:
   * 1. Score affinity against all active candidates
   * 2. If best score > threshold → assign to that candidate
   * 3. If no match and turn has callsigns → create new candidate
   * 4. If no match and no callsigns → assign to primary (if exists)
   */
  routeTurn(turn: ProcessedTurn): RouteTurnResult {
    const activeCandidates = this.getActive();
    const turnCallsigns = turn.features.callsignCandidates
      .map(c => c.value.toUpperCase())
      .filter(cs => cs !== this.myCallsign);

    // Score all active candidates
    let bestCandidate: QSOCandidate | null = null;
    let bestScore = 0;

    for (const candidate of activeCandidates) {
      const score = candidate.scoreAffinity(turn);
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    // Best match above threshold
    if (bestCandidate && bestScore >= this.affinityThreshold) {
      return { candidate: bestCandidate, isNew: false };
    }

    // No good match — if primary has no callsigns yet, adopt this turn's callsigns
    // instead of creating a new candidate (common in the early phase of a QSO)
    if (turnCallsigns.length > 0) {
      const primary = this.getPrimary();
      if (primary && primary.callsigns.size === 0
        && (primary.getStatus() === 'candidate' || primary.getStatus() === 'active')) {
        for (const cs of turnCallsigns) {
          primary.registerCallsign(cs);
        }
        return { candidate: primary, isNew: false };
      }

      const newCandidate = this.createCandidate(turnCallsigns[0]);
      for (const cs of turnCallsigns.slice(1)) {
        newCandidate.registerCallsign(cs);
      }

      // If no primary exists, this becomes primary
      if (!this.primaryId) {
        this.primaryId = newCandidate.id;
        newCandidate.isPrimary = true;
      }

      this.prune();
      return { candidate: newCandidate, isNew: true };
    }

    // No callsigns in turn — fall back to primary
    const primary = this.getPrimary();
    if (primary) {
      return { candidate: primary, isNew: false };
    }

    // No primary and no callsigns — create an empty candidate
    const emptyCandidate = this.createCandidate();
    this.primaryId = emptyCandidate.id;
    emptyCandidate.isPrimary = true;
    return { candidate: emptyCandidate, isNew: true };
  }

  // ─── Primary management ────────────────────────────────────────

  getPrimary(): QSOCandidate | null {
    if (!this.primaryId) return null;
    return this.candidates.get(this.primaryId) ?? null;
  }

  promoteToPrimary(candidateId: string): QSOCandidate | null {
    const candidate = this.candidates.get(candidateId);
    if (!candidate) return null;

    // Demote current primary
    const current = this.getPrimary();
    if (current) {
      current.isPrimary = false;
    }

    // Promote new
    this.primaryId = candidateId;
    candidate.isPrimary = true;
    return candidate;
  }

  /**
   * Check if any non-primary candidate should be promoted.
   * Promotion criteria: evidenceScore > primary's evidenceScore AND turnCount >= 2.
   */
  checkPromotion(): QSOCandidate | null {
    const primary = this.getPrimary();
    const primaryEvidence = primary?.getEvidenceScore() ?? 0;

    let bestCandidate: QSOCandidate | null = null;
    let bestEvidence = primaryEvidence;

    for (const candidate of this.candidates.values()) {
      if (candidate.id === this.primaryId) continue;
      if (candidate.getStatus() !== 'candidate' && candidate.getStatus() !== 'active') continue;

      const evidence = candidate.getEvidenceScore();
      if (evidence > bestEvidence && candidate.turnCount >= 2) {
        bestEvidence = evidence;
        bestCandidate = candidate;
      }
    }

    if (bestCandidate) {
      this.promoteToPrimary(bestCandidate.id);
      return bestCandidate;
    }

    return null;
  }

  // ─── Candidate access ──────────────────────────────────────────

  get(candidateId: string): QSOCandidate | null {
    return this.candidates.get(candidateId) ?? null;
  }

  getActive(): QSOCandidate[] {
    return Array.from(this.candidates.values()).filter(
      c => c.getStatus() === 'candidate' || c.getStatus() === 'active'
    );
  }

  getAll(): QSOCandidate[] {
    return Array.from(this.candidates.values());
  }

  getAllInfo(): QSOCandidateInfo[] {
    return this.getAll().map(c => c.getInfo());
  }

  // ─── Lifecycle ─────────────────────────────────────────────────

  closeCandidate(candidateId: string): void {
    const candidate = this.candidates.get(candidateId);
    if (!candidate) return;
    candidate.close();

    if (this.primaryId === candidateId) {
      this.primaryId = null;
      // Try to promote the next best active candidate
      const active = this.getActive();
      if (active.length > 0) {
        const best = active.reduce((a, b) =>
          a.getEvidenceScore() > b.getEvidenceScore() ? a : b
        );
        this.primaryId = best.id;
        best.isPrimary = true;
      }
    }
  }

  /**
   * Prune low-evidence or old candidates.
   */
  prune(): void {
    const active = this.getActive();
    if (active.length <= this.maxCandidates) return;

    // Sort by evidence score descending, abandon the weakest
    const sorted = active.sort((a, b) => b.getEvidenceScore() - a.getEvidenceScore());
    for (let i = this.maxCandidates; i < sorted.length; i++) {
      if (sorted[i].id !== this.primaryId) {
        sorted[i].abandon();
      }
    }
  }

  /**
   * Clear all candidates and reset state.
   */
  clear(): void {
    this.candidates.clear();
    this.primaryId = null;
  }

  /**
   * Update metadata for all active candidates and track current values.
   */
  updateMetadata(frequency: number, mode: string): void {
    this.currentFrequency = frequency;
    this.currentMode = mode;
    for (const candidate of this.getActive()) {
      candidate.updateMetadata(frequency, mode);
    }
  }

  /**
   * Create a new candidate initialized with current metadata.
   */
  private createCandidate(initialCallsign?: string): QSOCandidate {
    const candidate = new QSOCandidate(this.myCallsign, initialCallsign);
    if (this.currentFrequency > 0 || this.currentMode) {
      candidate.updateMetadata(this.currentFrequency, this.currentMode);
    }
    this.candidates.set(candidate.id, candidate);
    return candidate;
  }
}
