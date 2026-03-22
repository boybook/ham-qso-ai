import EventEmitter from 'eventemitter3';
import { createActor } from 'xstate';
import type { ProcessedTurn } from '../types/turn.js';
import type { FieldCandidate } from '../types/qso.js';
import type { TraceEntry } from '../types/trace.js';
import type { QSOCandidateInfo } from '../types/candidate.js';
import { qsoStateMachine, type QSOState, type QSOMachineContext } from './QSOStateMachine.js';
import { QSOCandidateManager } from './QSOCandidateManager.js';
import { QSOCandidate } from './QSOCandidate.js';

/**
 * Events emitted by the QSO session engine.
 */
export interface QSOSessionEngineEvents {
  'stateChanged': (state: QSOState) => void;
  'sessionStarted': (candidateId: string) => void;
  'sessionClosed': (candidateId: string) => void;
  'turnProcessed': (turn: ProcessedTurn) => void;
}

/**
 * QSO Session Engine orchestrates the state machine and multi-candidate
 * system for tracking QSO lifecycles.
 *
 * Key changes from v1:
 * - Uses QSOCandidateManager instead of single turns[]/trace[]/resolver
 * - Session starts at 'locked' (not 'seeking') to avoid premature drafts
 * - Each candidate independently maintains its own turns, field pools, trace
 * - Supports interruption detection and candidate competition
 */
export class QSOSessionEngine extends EventEmitter<QSOSessionEngineEvents> {
  private actor: ReturnType<typeof createActor<typeof qsoStateMachine>>;
  private readonly candidateManager: QSOCandidateManager;
  private readonly myCallsign: string;
  private sessionStartedForPrimary: boolean = false;

  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly silenceTimeout: number;
  private readonly holdTimeout: number;

  constructor(options: {
    myCallsign: string;
    silenceTimeout?: number;
    holdTimeout?: number;
  }) {
    super();
    this.myCallsign = options.myCallsign.toUpperCase();
    this.silenceTimeout = options.silenceTimeout ?? 15000;
    this.holdTimeout = options.holdTimeout ?? 120000;
    this.candidateManager = new QSOCandidateManager({ myCallsign: this.myCallsign });

    this.actor = createActor(qsoStateMachine);
    this.setupActorSubscription();
  }

  private setupActorSubscription(): void {
    this.actor.subscribe(snapshot => {
      const state = snapshot.value as QSOState;
      this.emit('stateChanged', state);

      // Session starts at locked (not seeking) to avoid premature drafts
      if (state === 'locked' && !this.sessionStartedForPrimary) {
        const primary = this.candidateManager.getPrimary();
        if (primary) {
          primary.promote();
          this.sessionStartedForPrimary = true;
          this.emit('sessionStarted', primary.id);
        }
      }
    });
  }

  start(): void {
    this.actor.start();
  }

  stop(): void {
    this.clearTimers();
    this.actor.stop();
  }

  getState(): QSOState {
    return this.actor.getSnapshot().value as QSOState;
  }

  getContext(): QSOMachineContext {
    return this.actor.getSnapshot().context;
  }

  /**
   * Get current QSO ID (primary candidate's ID).
   */
  getCurrentQsoId(): string | null {
    return this.candidateManager.getPrimary()?.id ?? null;
  }

  /**
   * Get turns for the primary candidate.
   */
  getTurns(): ProcessedTurn[] {
    return this.candidateManager.getPrimary()?.getTurns() ?? [];
  }

  /**
   * Get trace for the primary candidate.
   */
  getTrace(): TraceEntry[] {
    return this.candidateManager.getPrimary()?.getTrace() ?? [];
  }

  /**
   * Get all candidate info.
   */
  getCandidates(): QSOCandidateInfo[] {
    return this.candidateManager.getAllInfo();
  }

  /**
   * Get the primary candidate.
   */
  getPrimaryCandidate(): QSOCandidate | null {
    return this.candidateManager.getPrimary();
  }

  /**
   * Get a candidate by ID (any candidate, not just primary).
   */
  getCandidate(candidateId: string): QSOCandidate | null {
    return this.candidateManager.get(candidateId);
  }

  /**
   * Process a new turn from the pipeline.
   */
  processTurn(turn: ProcessedTurn): void {
    // Route turn to the best-matching candidate
    const { candidate, isNew } = this.candidateManager.routeTurn(turn);
    candidate.addTurn(turn);

    // Reset silence timer
    this.resetSilenceTimer();

    // Drive the global state machine
    this.actor.send({ type: 'TURN_RECEIVED', turn });

    // Process callsign candidates for state machine
    for (const c of turn.features.callsignCandidates) {
      this.processCallsign(c, turn, candidate);
    }

    // Closing signals
    if (turn.features.closingSignals.length > 0) {
      const maxScore = Math.max(...turn.features.closingSignals.map(s => s.confidence));
      this.actor.send({ type: 'CLOSING_DETECTED', score: maxScore });
      candidate.addTraceEntry('rule', 'closing_detected', [`Score: ${maxScore}`], turn.id);
    }

    // Interruption detection: new candidate while locked
    if (isNew && this.getState() === 'locked') {
      const newCallsigns = turn.features.callsignCandidates
        .map(c => c.value.toUpperCase())
        .filter(cs => cs !== this.myCallsign);
      if (newCallsigns.length > 0) {
        this.actor.send({ type: 'INTERRUPTION_DETECTED', interrupterCallsign: newCallsigns[0] });
        candidate.addTraceEntry('rule', 'interruption_detected', [
          `Interrupter: ${newCallsigns[0]}`,
        ], turn.id);
      }
    }

    this.emit('turnProcessed', turn);
    this.checkDualCallsigns();

    // Check if a non-primary candidate should be promoted
    this.candidateManager.checkPromotion();
  }

  /**
   * Process late-arriving features (e.g., from async LLM).
   * Feeds callsigns and signals into the primary candidate and state machine
   * without creating a new turn.
   */
  processLateFeatures(features: import('../types/turn.js').TurnFeatures): void {
    const candidate = this.candidateManager.getPrimary();

    for (const c of features.callsignCandidates) {
      const cs = c.value.toUpperCase();
      if (cs !== this.myCallsign) {
        candidate?.registerCallsign(cs);
        // Drive state machine
        this.actor.send({ type: 'CALLSIGN_DETECTED', callsign: cs, direction: 'rx', confidence: c.confidence });
      }
    }

    if (features.closingSignals.length > 0) {
      const maxScore = Math.max(...features.closingSignals.map(s => s.confidence));
      this.actor.send({ type: 'CLOSING_DETECTED', score: maxScore });
    }

    this.checkDualCallsigns();
  }

  onFrequencyChanged(newFrequency: number): void {
    const currentState = this.getState();
    if (currentState !== 'idle') {
      this.actor.send({ type: 'FREQUENCY_CHANGED', newFrequency });
      const primary = this.candidateManager.getPrimary();
      primary?.addTraceEntry('system', 'frequency_changed', [`New freq: ${newFrequency}`]);
      this.handleClosed();
    }
  }

  /**
   * Update metadata for all active candidates.
   */
  updateMetadata(frequency: number, mode: string): void {
    this.candidateManager.updateMetadata(frequency, mode);
  }

  reset(): void {
    this.clearTimers();
    const state = this.getState();
    if (state !== 'closed') {
      this.actor.send({ type: 'RESET' });
    } else {
      this.actor.stop();
      this.actor = createActor(qsoStateMachine);
      this.setupActorSubscription();
      this.actor.start();
    }
    this.candidateManager.clear();
    this.sessionStartedForPrimary = false;
  }

  private processCallsign(candidate: FieldCandidate<string>, turn: ProcessedTurn, qsoCandidate: QSOCandidate): void {
    const callsign = candidate.value.toUpperCase();
    const isMyCallsign = callsign === this.myCallsign;
    const speakerIsMe = turn.direction === 'tx' || isMyCallsign;

    if (!speakerIsMe) {
      this.actor.send({
        type: 'CALLSIGN_DETECTED',
        callsign,
        direction: turn.direction,
        confidence: candidate.confidence,
      });
    }

    qsoCandidate.addTraceEntry('rule', 'callsign_processed', [
      `Callsign: ${callsign}`,
      `Direction: ${turn.direction}`,
      `IsMyCallsign: ${isMyCallsign}`,
    ], turn.id);
  }

  private checkDualCallsigns(): void {
    const ctx = this.getContext();
    const state = this.getState();

    if (state !== 'seeking') return;
    if (ctx.dualCallsignsConfirmed) return;

    const primary = this.candidateManager.getPrimary();
    if (!primary) return;

    const uniqueCallsigns = new Set(ctx.detectedCallsigns.map(c => c.callsign));
    const hasTx = primary.hasTxTurns;

    if (hasTx) {
      if (uniqueCallsigns.size >= 1) {
        this.actor.send({ type: 'DUAL_CALLSIGNS_CONFIRMED' });
        primary.addTraceEntry('rule', 'dual_callsigns_confirmed', [
          `Mode: participate`, `Callsigns: ${[...uniqueCallsigns].join(', ')}`,
        ]);
      }
    } else {
      if (uniqueCallsigns.size >= 2) {
        this.actor.send({ type: 'DUAL_CALLSIGNS_CONFIRMED' });
        primary.addTraceEntry('rule', 'dual_callsigns_confirmed', [
          `Mode: monitor`, `Callsigns: ${[...uniqueCallsigns].join(', ')}`,
        ]);
      }
    }
  }

  private resetSilenceTimer(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    if (this.holdTimer) clearTimeout(this.holdTimer);

    this.silenceTimer = setTimeout(() => {
      const state = this.getState();
      if (state === 'seeking' || state === 'locked' || state === 'interrupted' || state === 'resuming') {
        this.actor.send({ type: 'SILENCE_TIMEOUT' });

        const newState = this.getState();
        if (newState === 'hold') {
          this.startHoldTimer();
        } else if (newState === 'closed') {
          this.handleClosed();
        }
      }
    }, this.silenceTimeout);
  }

  private startHoldTimer(): void {
    this.holdTimer = setTimeout(() => {
      if (this.getState() === 'hold') {
        this.actor.send({ type: 'HOLD_TIMEOUT' });
        this.handleClosed();
      }
    }, this.holdTimeout);
  }

  private handleClosed(): void {
    const primary = this.candidateManager.getPrimary();
    if (primary) {
      primary.close();
      this.emit('sessionClosed', primary.id);
      primary.addTraceEntry('system', 'session_closed', [
        `Candidate ID: ${primary.id}`,
        `Turns: ${primary.turnCount}`,
      ]);
    }
  }

  private clearTimers(): void {
    if (this.silenceTimer) { clearTimeout(this.silenceTimer); this.silenceTimer = null; }
    if (this.holdTimer) { clearTimeout(this.holdTimer); this.holdTimer = null; }
  }
}
