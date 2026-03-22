import { v4 as uuidv4 } from 'uuid';
import type { QSOCandidateStatus, QSOCandidateInfo } from '../types/candidate.js';
import type { QSOFields, ResolvedField } from '../types/qso.js';
import type { ProcessedTurn } from '../types/turn.js';
import type { TraceEntry } from '../types/trace.js';
import { VotingFieldResolver, type ResolvedStationData } from '../resolver/FieldCandidateResolver.js';

/**
 * A QSO candidate represents a potential radio contact being tracked.
 *
 * Each candidate independently maintains its own:
 * - Turn history
 * - Field candidate pools (via VotingFieldResolver)
 * - Closing score
 * - Decision trace
 * - Callsign set
 *
 * Candidates start as 'candidate', get promoted to 'active' when confirmed,
 * and end as 'closed' or 'abandoned'.
 */
export class QSOCandidate {
  readonly id: string;
  private status: QSOCandidateStatus = 'candidate';
  private readonly resolver: VotingFieldResolver;
  private readonly _turns: ProcessedTurn[] = [];
  private readonly _trace: TraceEntry[] = [];
  private readonly _callsigns: Set<string> = new Set();
  private _closingScore: number = 0;
  private _isPrimary: boolean = false;
  private readonly _createdAt: number;
  private _lastActivityAt: number;
  private _hasTxTurns: boolean = false;
  private readonly myCallsign: string;
  private frequency: number = 0;
  private mode: string = '';

  constructor(myCallsign: string, initialCallsign?: string) {
    this.id = uuidv4();
    this.myCallsign = myCallsign.toUpperCase();
    this.resolver = new VotingFieldResolver(myCallsign);
    this._createdAt = Date.now();
    this._lastActivityAt = Date.now();

    if (initialCallsign) {
      this._callsigns.add(initialCallsign.toUpperCase());
    }
  }

  // ─── Turn management ──────────────────────────────────────────

  /**
   * Add a processed turn to this candidate.
   * Updates the internal resolver and activity tracking.
   */
  addTurn(turn: ProcessedTurn): void {
    this._turns.push(turn);
    this._lastActivityAt = Date.now();
    if (turn.direction === 'tx') this._hasTxTurns = true;

    // Feed the turn into this candidate's own resolver
    this.resolver.processTurn(turn);

    // Register any callsigns found in the turn
    for (const c of turn.features.callsignCandidates) {
      const cs = c.value.toUpperCase();
      if (cs !== this.myCallsign) {
        this._callsigns.add(cs);
      }
    }

    // Update closing score
    if (turn.features.closingSignals.length > 0) {
      const maxSignal = Math.max(...turn.features.closingSignals.map(s => s.confidence));
      this._closingScore = Math.max(this._closingScore, maxSignal);
    } else {
      // New non-closing turn reduces closing score
      this._closingScore = Math.max(0, this._closingScore - 0.2);
    }
  }

  // ─── Callsign management ──────────────────────────────────────

  /**
   * Register a callsign associated with this candidate.
   */
  registerCallsign(callsign: string): void {
    this._callsigns.add(callsign.toUpperCase());
  }

  /**
   * Check if a callsign is known to this candidate.
   */
  hasCallsign(callsign: string): boolean {
    return this._callsigns.has(callsign.toUpperCase());
  }

  // ─── Affinity scoring ─────────────────────────────────────────

  /**
   * Score how likely a turn belongs to this candidate (0-1).
   *
   * Based on:
   * - Callsign overlap (high weight)
   * - Time proximity (medium weight)
   * - Direction pattern (low weight)
   */
  scoreAffinity(turn: ProcessedTurn): number {
    let score = 0;

    // Callsign overlap: if any callsign in the turn matches this candidate
    const turnCallsigns = turn.features.callsignCandidates.map(c => c.value.toUpperCase());
    const overlap = turnCallsigns.filter(cs => this._callsigns.has(cs) || cs === this.myCallsign);

    if (overlap.length > 0) {
      // Strong match: turn mentions a callsign we know
      score += 0.6;
      // Extra boost if it mentions our specific counterpart (not just myCallsign)
      const hasCounterpart = overlap.some(cs => cs !== this.myCallsign && this._callsigns.has(cs));
      if (hasCounterpart) score += 0.2;
    }

    // Time proximity: how recently was this candidate active?
    const timeSinceLastActivity = Date.now() - this._lastActivityAt;
    if (timeSinceLastActivity < 5000) score += 0.15;       // < 5s
    else if (timeSinceLastActivity < 15000) score += 0.1;   // < 15s
    else if (timeSinceLastActivity < 60000) score += 0.05;  // < 1min

    // No callsign in turn but candidate is primary and recent → weak affinity
    if (turnCallsigns.length === 0 && this._isPrimary && timeSinceLastActivity < 30000) {
      score += 0.3;
    }

    return Math.min(1, score);
  }

  // ─── Lifecycle ─────────────────────────────────────────────────

  /** Promote from 'candidate' to 'active'. */
  promote(): void {
    if (this.status === 'candidate') {
      this.status = 'active';
      this.addTraceEntry('system', 'candidate_promoted', ['Promoted to active']);
    }
  }

  /** Mark as closed (QSO ended normally). */
  close(): void {
    this.status = 'closed';
    this.addTraceEntry('system', 'candidate_closed', ['QSO closed']);
  }

  /** Mark as abandoned (insufficient evidence or superseded). */
  abandon(): void {
    this.status = 'abandoned';
    this.addTraceEntry('system', 'candidate_abandoned', ['Candidate abandoned']);
  }

  // ─── Metadata ──────────────────────────────────────────────────

  updateMetadata(frequency: number, mode: string): void {
    this.frequency = frequency;
    this.mode = mode;
    this.resolver.updateMetadata(frequency, mode);
  }

  // ─── Accessors ─────────────────────────────────────────────────

  get isPrimary(): boolean { return this._isPrimary; }
  set isPrimary(v: boolean) { this._isPrimary = v; }

  get closingScore(): number { return this._closingScore; }
  set closingScore(v: number) { this._closingScore = v; }

  get hasTxTurns(): boolean { return this._hasTxTurns; }

  get callsigns(): ReadonlySet<string> { return this._callsigns; }

  get turnCount(): number { return this._turns.length; }

  getStatus(): QSOCandidateStatus { return this.status; }

  getTurns(): ProcessedTurn[] { return [...this._turns]; }

  getTrace(): TraceEntry[] { return [...this._trace]; }

  getLastActivityAt(): number { return this._lastActivityAt; }

  /** Resolve QSO-level fields (frequency, mode, time, myCallsign). */
  resolveFields(): QSOFields { return this.resolver.resolve(); }

  /** Resolve station-specific data (callsign, RST, name, QTH, grid). */
  resolveStationData(): ResolvedStationData { return this.resolver.resolveStationData(); }

  /** Get the best resolved callsign for the other station. */
  getTheirCallsign(): ResolvedField<string> {
    return this.resolver.resolveStationData().theirCallsign;
  }

  /** Get all callsign candidates above threshold. */
  getCallsignCandidates(): ResolvedStationData['callsignCandidates'] {
    return this.resolver.resolveStationData().callsignCandidates;
  }

  /** Get RST sent to the other station. */
  getRstSent(): ResolvedField<string> {
    return this.resolver.resolveStationData().rstSent;
  }

  /** Get RST received from the other station. */
  getRstReceived(): ResolvedField<string> {
    return this.resolver.resolveStationData().rstReceived;
  }

  isReady(minConfidence?: number): boolean { return this.resolver.isReady(minConfidence); }

  /**
   * Compute evidence score: how confident are we that this is a real QSO?
   */
  getEvidenceScore(): number {
    let score = 0;

    // Multiple callsigns detected
    if (this._callsigns.size >= 1) score += 0.3;
    if (this._callsigns.size >= 2) score += 0.2;

    // Multiple turns
    if (this._turns.length >= 2) score += 0.2;
    if (this._turns.length >= 4) score += 0.1;

    // Has TX turns (participate mode = higher certainty)
    if (this._hasTxTurns) score += 0.1;

    // Has RST exchange
    const stationData = this.resolver.resolveStationData();
    if (stationData.rstSent.confidence > 0.5) score += 0.05;
    if (stationData.rstReceived.confidence > 0.5) score += 0.05;

    return Math.min(1, score);
  }

  getInfo(): QSOCandidateInfo {
    return {
      id: this.id,
      status: this.status,
      callsigns: [...this._callsigns],
      isPrimary: this._isPrimary,
      createdAt: this._createdAt,
      lastActivityAt: this._lastActivityAt,
      turnCount: this._turns.length,
      evidenceScore: this.getEvidenceScore(),
      closingScore: this._closingScore,
    };
  }

  // ─── Trace ─────────────────────────────────────────────────────

  addTraceEntry(actor: TraceEntry['actor'], action: string, reasons: string[], turnId?: string): void {
    this._trace.push({
      timestamp: Date.now(),
      actor,
      action,
      reasons,
      qsoId: this.id,
      turnId,
    });
  }
}
