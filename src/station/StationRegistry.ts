import { StationContext, type StationSnapshot } from './StationContext.js';
import type { ProcessedTurn } from '../types/turn.js';
import type { FieldCandidate } from '../types/qso.js';
import { createLogger, type ILogger } from '../utils/logger.js';

/**
 * Serializable snapshot of the entire station registry.
 */
export interface StationRegistrySnapshot {
  stations: StationSnapshot[];
  exportedAt: number;
}

/**
 * Station Registry — a long-lived knowledge base of amateur radio stations.
 *
 * Each callsign heard on the air gets a StationContext that accumulates
 * information over time (QTH, name, grid, equipment). The registry
 * persists across QSO boundaries and can be serialized for cross-session use.
 *
 * Usage:
 * - Pipeline calls `feedTurn()` after each turn is processed
 * - The registry routes QTH/name/grid info to the appropriate station
 * - QSO Drafts reference stations by callsign, reading their resolved fields
 */
export class StationRegistry {
  private readonly stations: Map<string, StationContext> = new Map();
  private readonly logger: ILogger;

  constructor(logger?: ILogger) {
    this.logger = createLogger('StationRegistry', logger);
  }

  /**
   * Get or create a station context for a callsign.
   */
  getOrCreate(callsign: string, confidence?: number): StationContext {
    const key = callsign.toUpperCase();
    let station = this.stations.get(key);
    if (!station) {
      station = new StationContext(key, confidence);
      this.stations.set(key, station);
      this.logger.debug('station created', { callsign: key });
    }
    return station;
  }

  /**
   * Get a station by callsign, or null if not known.
   */
  get(callsign: string): StationContext | null {
    return this.stations.get(callsign.toUpperCase()) ?? null;
  }

  /**
   * Get all known stations.
   */
  getAll(): StationContext[] {
    return Array.from(this.stations.values());
  }

  /**
   * Number of known stations.
   */
  get size(): number {
    return this.stations.size;
  }

  /**
   * Feed a processed turn into the registry.
   *
   * Routes information to the appropriate station based on context:
   * - Callsign candidates → create/update station entries
   * - QTH/Name/Grid → assigned to the most recently mentioned station
   *   (the station that is "speaking" in this turn)
   */
  feedTurn(turn: ProcessedTurn): string[] {
    const mentionedCallsigns: string[] = [];

    // Register all callsigns and track mentions
    for (const c of turn.features.callsignCandidates) {
      const station = this.getOrCreate(c.value, c.confidence);
      station.recordMention(c.confidence);
      mentionedCallsigns.push(station.callsign);
    }

    // Assign contextual fields to the "speaker" station.
    // Heuristic: the last-mentioned callsign in this turn is likely the speaker.
    // In "这里是BG7ABS，QTH贵州", BG7ABS is the speaker and owns the QTH.
    const speakerCallsign = this.inferSpeaker(turn, mentionedCallsigns);
    if (speakerCallsign) {
      const speaker = this.stations.get(speakerCallsign);
      if (speaker) {
        if (turn.features.qthCandidates.length > 0) {
          speaker.feedQTH(turn.features.qthCandidates);
        }
        if (turn.features.nameCandidates.length > 0) {
          speaker.feedName(turn.features.nameCandidates);
        }
        if (turn.features.gridCandidates.length > 0) {
          speaker.feedGrid(turn.features.gridCandidates);
        }
      }
    }

    return mentionedCallsigns;
  }

  /**
   * Feed late-arriving LLM features into the registry.
   */
  feedLateFeatures(features: import('../types/turn.js').TurnFeatures): string[] {
    const callsigns: string[] = [];
    for (const c of features.callsignCandidates) {
      const station = this.getOrCreate(c.value, c.confidence);
      station.recordMention(c.confidence);
      callsigns.push(station.callsign);
    }
    // QTH from late features — assign to first callsign if present
    if (callsigns.length > 0 && features.qthCandidates.length > 0) {
      this.stations.get(callsigns[0])?.feedQTH(features.qthCandidates);
    }
    return callsigns;
  }

  // ─── Serialization ─────────────────────────────────────────────

  /**
   * Export the entire registry as a serializable snapshot.
   */
  export(): StationRegistrySnapshot {
    return {
      stations: this.getAll().map(s => s.toSnapshot()),
      exportedAt: Date.now(),
    };
  }

  /**
   * Import stations from a previously exported snapshot.
   * Merges with existing data (existing stations take precedence).
   */
  import(snapshot: StationRegistrySnapshot): void {
    for (const ss of snapshot.stations) {
      const key = ss.callsign.toUpperCase();
      if (!this.stations.has(key)) {
        this.stations.set(key, StationContext.fromSnapshot(ss));
        this.logger.debug('station imported', { callsign: key });
      }
    }
    this.logger.info('registry imported', {
      imported: snapshot.stations.length,
      total: this.stations.size,
    });
  }

  /**
   * Clear all stations.
   */
  clear(): void {
    this.stations.clear();
  }

  // ─── Speaker inference ─────────────────────────────────────────

  /**
   * Infer which station is the "speaker" in a turn.
   *
   * Heuristics:
   * - TX turn → speaker is myCallsign (handled by caller)
   * - If turn mentions exactly 1 callsign → that's the speaker
   * - If turn mentions 2+ callsigns → the first one after "这里是" or "this is"
   *   patterns is likely the speaker; otherwise fall back to last mentioned
   */
  private inferSpeaker(turn: ProcessedTurn, mentionedCallsigns: string[]): string | null {
    if (mentionedCallsigns.length === 0) return null;
    if (mentionedCallsigns.length === 1) return mentionedCallsigns[0];

    // Look for "这里是 XX" or "this is XX" pattern — XX is the speaker
    const text = turn.text.toLowerCase();
    const selfIntroPatterns = ['这里是', 'this is', 'de '];
    for (const pattern of selfIntroPatterns) {
      const idx = text.indexOf(pattern);
      if (idx >= 0) {
        // Find which callsign appears closest after the pattern
        for (const cs of mentionedCallsigns) {
          const csIdx = text.indexOf(cs.toLowerCase(), idx);
          if (csIdx >= 0 && csIdx - idx < 30) {
            return cs;
          }
        }
      }
    }

    // Fallback: last mentioned callsign
    return mentionedCallsigns[mentionedCallsigns.length - 1];
  }
}
