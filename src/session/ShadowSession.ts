import { v4 as uuidv4 } from 'uuid';
import type { FieldCandidate } from '../types/qso.js';

/**
 * A shadow session tracks a potential secondary QSO
 * (e.g., a break-in station or third party).
 *
 * Shadow sessions are lighter than the main session —
 * they only track callsign mentions and activity timestamps
 * to decide whether they should be promoted to the main session.
 */
export interface ShadowSession {
  /** Unique ID */
  id: string;
  /** The callsign being tracked */
  callsign: string;
  /** Confidence of this shadow session */
  confidence: number;
  /** Number of times this callsign has been mentioned */
  mentionCount: number;
  /** First mention timestamp */
  firstSeenAt: number;
  /** Last mention timestamp */
  lastSeenAt: number;
  /** Turn IDs where this callsign appeared */
  turnIds: string[];
}

/**
 * Manages shadow sessions for tracking potential secondary QSOs.
 */
export class ShadowSessionManager {
  private sessions: Map<string, ShadowSession> = new Map();
  private readonly maxShadows: number;

  constructor(maxShadows: number = 3) {
    this.maxShadows = maxShadows;
  }

  /**
   * Report a callsign mention. Creates or updates a shadow session.
   */
  report(callsign: string, confidence: number, turnId: string): ShadowSession {
    const normalized = callsign.toUpperCase();
    let session = this.sessions.get(normalized);

    if (!session) {
      session = {
        id: uuidv4(),
        callsign: normalized,
        confidence,
        mentionCount: 0,
        firstSeenAt: Date.now(),
        lastSeenAt: Date.now(),
        turnIds: [],
      };
      this.sessions.set(normalized, session);
    }

    session.mentionCount++;
    session.lastSeenAt = Date.now();
    session.confidence = Math.max(session.confidence, confidence);
    if (!session.turnIds.includes(turnId)) {
      session.turnIds.push(turnId);
    }

    // Prune if over limit (keep highest confidence)
    this.prune();

    return session;
  }

  /**
   * Check if any shadow session should be promoted to main session.
   * A shadow is promotable when it has enough mentions and confidence.
   */
  getPromotable(minMentions: number = 2, minConfidence: number = 0.6): ShadowSession | null {
    let best: ShadowSession | null = null;

    for (const session of this.sessions.values()) {
      if (session.mentionCount >= minMentions && session.confidence >= minConfidence) {
        if (!best || session.confidence > best.confidence) {
          best = session;
        }
      }
    }

    return best;
  }

  /**
   * Remove a shadow session (e.g., after promotion or dismissal).
   */
  remove(callsign: string): void {
    this.sessions.delete(callsign.toUpperCase());
  }

  /**
   * Get all active shadow sessions.
   */
  getAll(): ShadowSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Clear all shadow sessions.
   */
  clear(): void {
    this.sessions.clear();
  }

  private prune(): void {
    if (this.sessions.size <= this.maxShadows) return;

    // Sort by confidence descending, keep top N
    const sorted = Array.from(this.sessions.entries())
      .sort((a, b) => b[1].confidence - a[1].confidence);

    this.sessions.clear();
    for (let i = 0; i < this.maxShadows; i++) {
      this.sessions.set(sorted[i][0], sorted[i][1]);
    }
  }
}
