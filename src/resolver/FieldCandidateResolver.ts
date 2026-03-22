import type { QSOFields, ResolvedField, FieldCandidate } from '../types/qso.js';
import type { ProcessedTurn } from '../types/turn.js';
import { CandidatePool } from './CandidatePool.js';

/**
 * Field resolver interface.
 * All field resolution implementations must conform to this interface.
 */
export interface IFieldResolver {
  /** Process a turn and feed its candidates into resolution. */
  processTurn(turn: ProcessedTurn): void;
  /** Update radio metadata. */
  updateMetadata(frequency: number, mode: string): void;
  /** Resolve all fields to their best values. */
  resolve(): QSOFields;
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
    const callsignResolved = this.theirCallsign.resolve();

    // In monitor mode, collect all distinct station callsigns (not just the best one)
    let stationCallsigns: QSOFields['stationCallsigns'];
    if (callsignResolved?.candidates && callsignResolved.candidates.length > 1) {
      stationCallsigns = callsignResolved.candidates
        .filter(c => c.confidence > 0.3)
        .map(c => ({
          value: c.value as string,
          confidence: c.confidence,
          source: c.source,
        }));
    }

    return {
      theirCallsign: callsignResolved ?? {
        value: '', confidence: 0, source: 'rule',
      },
      stationCallsigns,
      rstSent: this.rstSent.resolve() ?? {
        value: '59', confidence: 0.3, source: 'rule',
      },
      rstReceived: this.rstReceived.resolve() ?? {
        value: '59', confidence: 0.3, source: 'rule',
      },
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
      theirName: this.theirName.resolve() ?? undefined,
      theirQTH: this.theirQTH.resolve() ?? undefined,
      theirGrid: this.theirGrid.resolve() ?? undefined,
      myCallsign: {
        value: this.myCallsign,
        confidence: 1.0,
        source: 'metadata',
      },
    };
  }

  isReady(minConfidence: number = 0.6): boolean {
    const fields = this.resolve();
    return (
      fields.theirCallsign.confidence >= minConfidence &&
      fields.frequency.confidence > 0 &&
      fields.mode.confidence > 0
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
