import { CandidatePool } from '../resolver/CandidatePool.js';
import type { FieldCandidate, ResolvedField } from '../types/qso.js';

/**
 * Serializable snapshot of a station's known information.
 */
export interface StationSnapshot {
  callsign: string;
  qth?: string;
  name?: string;
  grid?: string;
  equipment?: string;
  firstSeenAt: number;
  lastSeenAt: number;
  turnCount: number;
  confidence: number;
}

/**
 * Context for a single amateur radio station (callsign).
 *
 * Maintains all known information about a station — QTH, operator name,
 * grid locator, equipment. Information accumulates over time via
 * CandidatePool voting, and persists across QSO boundaries.
 *
 * This is the bottom-level entity in the Station-Centric model.
 * Multiple StationContexts are combined into QSO Drafts.
 */
export class StationContext {
  readonly callsign: string;
  readonly qth = new CandidatePool<string>();
  readonly name = new CandidatePool<string>();
  readonly grid = new CandidatePool<string>();
  readonly equipment = new CandidatePool<string>();

  private _firstSeenAt: number;
  private _lastSeenAt: number;
  private _turnCount: number = 0;
  private _callsignConfidence: number;

  constructor(callsign: string, confidence: number = 0.7) {
    this.callsign = callsign.toUpperCase();
    this._firstSeenAt = Date.now();
    this._lastSeenAt = Date.now();
    this._callsignConfidence = confidence;
  }

  /**
   * Record that this station was mentioned in a turn.
   * Increases confidence through repetition.
   */
  recordMention(confidence?: number): void {
    this._turnCount++;
    this._lastSeenAt = Date.now();
    if (confidence !== undefined && confidence > this._callsignConfidence) {
      this._callsignConfidence = confidence;
    }
  }

  /**
   * Feed QTH candidates (from a turn where this station was the speaker).
   */
  feedQTH(candidates: FieldCandidate<string>[]): void {
    this.qth.addAll(candidates);
  }

  /**
   * Feed name candidates.
   */
  feedName(candidates: FieldCandidate<string>[]): void {
    this.name.addAll(candidates);
  }

  /**
   * Feed grid candidates.
   */
  feedGrid(candidates: FieldCandidate<string>[]): void {
    this.grid.addAll(candidates);
  }

  /**
   * Feed equipment description candidates.
   */
  feedEquipment(candidates: FieldCandidate<string>[]): void {
    this.equipment.addAll(candidates);
  }

  // ─── Accessors ─────────────────────────────────────────────────

  get firstSeenAt(): number { return this._firstSeenAt; }
  get lastSeenAt(): number { return this._lastSeenAt; }
  get turnCount(): number { return this._turnCount; }

  get confidence(): number {
    // Base confidence + repetition bonus (capped at 1.0)
    const repeatBonus = Math.min(0.2, (this._turnCount - 1) * 0.05);
    return Math.min(1.0, this._callsignConfidence + repeatBonus);
  }

  resolveQTH(): ResolvedField<string> | undefined {
    return this.qth.resolve() ?? undefined;
  }

  resolveName(): ResolvedField<string> | undefined {
    return this.name.resolve() ?? undefined;
  }

  resolveGrid(): ResolvedField<string> | undefined {
    return this.grid.resolve() ?? undefined;
  }

  resolveEquipment(): ResolvedField<string> | undefined {
    return this.equipment.resolve() ?? undefined;
  }

  // ─── Serialization ─────────────────────────────────────────────

  /**
   * Export to a serializable snapshot.
   */
  toSnapshot(): StationSnapshot {
    return {
      callsign: this.callsign,
      qth: this.qth.resolve()?.value,
      name: this.name.resolve()?.value,
      grid: this.grid.resolve()?.value,
      equipment: this.equipment.resolve()?.value,
      firstSeenAt: this._firstSeenAt,
      lastSeenAt: this._lastSeenAt,
      turnCount: this._turnCount,
      confidence: this.confidence,
    };
  }

  /**
   * Restore from a snapshot (populates resolved values as high-confidence seeds).
   */
  static fromSnapshot(snapshot: StationSnapshot): StationContext {
    const station = new StationContext(snapshot.callsign, snapshot.confidence);
    station._firstSeenAt = snapshot.firstSeenAt;
    station._lastSeenAt = snapshot.lastSeenAt;
    station._turnCount = snapshot.turnCount;

    const now = Date.now();
    if (snapshot.qth) {
      station.qth.add({ value: snapshot.qth, confidence: 0.9, source: 'metadata', createdAt: now });
    }
    if (snapshot.name) {
      station.name.add({ value: snapshot.name, confidence: 0.9, source: 'metadata', createdAt: now });
    }
    if (snapshot.grid) {
      station.grid.add({ value: snapshot.grid, confidence: 0.9, source: 'metadata', createdAt: now });
    }
    if (snapshot.equipment) {
      station.equipment.add({ value: snapshot.equipment, confidence: 0.9, source: 'metadata', createdAt: now });
    }
    return station;
  }
}
