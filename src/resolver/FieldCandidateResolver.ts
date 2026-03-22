import type { QSOFields, ResolvedField, FieldCandidate } from '../types/qso.js';
import type { ProcessedTurn } from '../types/turn.js';
import { CandidatePool } from './CandidatePool.js';

/**
 * Station-specific data resolved from candidate pools.
 * Used by the pipeline to feed into StationRegistry / QSODraft.stations[].
 */
export interface ResolvedStationData {
  /** Best callsign candidate for the other station */
  theirCallsign: ResolvedField<string>;
  /** All callsign candidates above threshold (for multi-station scenarios) */
  callsignCandidates: Array<{ value: string; confidence: number; source: string }>;
  /** RST sent to the other station */
  rstSent: ResolvedField<string>;
  /** RST received from the other station */
  rstReceived: ResolvedField<string>;
  /** Other station's operator name */
  theirName?: ResolvedField<string>;
  /** Other station's QTH */
  theirQTH?: ResolvedField<string>;
  /** Other station's grid locator */
  theirGrid?: ResolvedField<string>;
}

/**
 * Field resolver interface.
 * All field resolution implementations must conform to this interface.
 */
export interface IFieldResolver {
  /** Process a turn and feed its candidates into resolution. */
  processTurn(turn: ProcessedTurn): void;
  /** Update radio metadata. */
  updateMetadata(frequency: number, mode: string): void;
  /** Resolve QSO-level fields (frequency, mode, time, myCallsign). */
  resolve(): QSOFields;
  /** Resolve station-specific data (callsign, RST, name, QTH, grid). */
  resolveStationData(): ResolvedStationData;
  /** Check if all required fields are resolved with sufficient confidence. */
  isReady(minConfidence?: number): boolean;
  /** Clear all state. */
  clear(): void;
}

/**
 * Voting-based field resolver.
 * Maintains candidate pools where multiple mentions accumulate confidence.
 * Deterministic, fast, no external dependencies.
 */
export class VotingFieldResolver implements IFieldResolver {
  readonly theirCallsign = new CandidatePool<string>();
  readonly rstSent = new CandidatePool<string>();
  readonly rstReceived = new CandidatePool<string>();
  readonly theirName = new CandidatePool<string>();
  readonly theirQTH = new CandidatePool<string>();
  readonly theirGrid = new CandidatePool<string>();

  private readonly myCallsign: string;
  private frequency: number = 0;
  private mode: string = '';
  private startTime: number = 0;
  private endTime: number = 0;
  private hasTx: boolean = false;

  constructor(myCallsign: string) {
    this.myCallsign = myCallsign;
  }

  processTurn(turn: ProcessedTurn): void {
    const isTx = turn.direction === 'tx';
    if (isTx) this.hasTx = true;

    if (!this.startTime) this.startTime = turn.startTime;
    this.endTime = turn.endTime;

    for (const c of turn.features.callsignCandidates) {
      const isMyCallsign = c.value.toUpperCase() === this.myCallsign.toUpperCase();
      if (!isMyCallsign) {
        this.theirCallsign.add(c);
      }
    }

    for (const c of turn.features.rstCandidates) {
      if (isTx) {
        this.rstSent.add(c);
      } else if (this.hasTx) {
        this.rstReceived.add(c);
      } else {
        if (this.rstSent.isEmpty) {
          this.rstSent.add(c);
        } else {
          this.rstReceived.add(c);
        }
      }
    }

    this.theirName.addAll(turn.features.nameCandidates);
    this.theirQTH.addAll(turn.features.qthCandidates);
    this.theirGrid.addAll(turn.features.gridCandidates);
  }

  updateMetadata(frequency: number, mode: string): void {
    this.frequency = frequency;
    this.mode = mode;
  }

  resolve(): QSOFields {
    return {
      frequency: {
        value: this.frequency,
        confidence: this.frequency > 0 ? 1.0 : 0,
        source: 'metadata',
      },
      mode: {
        value: this.mode,
        confidence: this.mode ? 1.0 : 0,
        source: 'metadata',
      },
      startTime: {
        value: this.startTime,
        confidence: this.startTime > 0 ? 1.0 : 0,
        source: 'metadata',
      },
      endTime: this.endTime > 0 ? {
        value: this.endTime,
        confidence: 1.0,
        source: 'metadata',
      } : undefined,
      myCallsign: {
        value: this.myCallsign,
        confidence: 1.0,
        source: 'metadata',
      },
    };
  }

  resolveStationData(): ResolvedStationData {
    const callsignResolved = this.theirCallsign.resolve();

    // Collect all callsign candidates above threshold for multi-station scenarios
    const callsignCandidates: ResolvedStationData['callsignCandidates'] = [];
    if (callsignResolved?.candidates) {
      for (const c of callsignResolved.candidates) {
        if (c.confidence > 0.3) {
          callsignCandidates.push({
            value: c.value as string,
            confidence: c.confidence,
            source: c.source,
          });
        }
      }
    }

    return {
      theirCallsign: callsignResolved ?? {
        value: '', confidence: 0, source: 'rule',
      },
      callsignCandidates,
      rstSent: this.rstSent.resolve() ?? {
        value: '59', confidence: 0.3, source: 'rule',
      },
      rstReceived: this.rstReceived.resolve() ?? {
        value: '59', confidence: 0.3, source: 'rule',
      },
      theirName: this.theirName.resolve() ?? undefined,
      theirQTH: this.theirQTH.resolve() ?? undefined,
      theirGrid: this.theirGrid.resolve() ?? undefined,
    };
  }

  isReady(minConfidence: number = 0.6): boolean {
    // Check if any callsign candidate meets the confidence threshold
    const callsignResolved = this.theirCallsign.resolve();
    const hasCallsign = callsignResolved !== null && callsignResolved.confidence >= minConfidence;

    return (
      hasCallsign &&
      this.frequency > 0 &&
      this.mode !== ''
    );
  }

  clear(): void {
    this.theirCallsign.clear();
    this.rstSent.clear();
    this.rstReceived.clear();
    this.theirName.clear();
    this.theirQTH.clear();
    this.theirGrid.clear();
    this.startTime = 0;
    this.endTime = 0;
    this.hasTx = false;
  }
}

/** Alias for backwards compatibility */
export const FieldCandidateResolver = VotingFieldResolver;
