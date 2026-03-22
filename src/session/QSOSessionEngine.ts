import EventEmitter from 'eventemitter3';
import { createActor, type Actor } from 'xstate';
import { v4 as uuidv4 } from 'uuid';
import type { ProcessedTurn } from '../types/turn.js';
import type { QSODraft, FieldCandidate } from '../types/qso.js';
import type { TraceEntry } from '../types/trace.js';
import { qsoStateMachine, type QSOState, type QSOEvent, type QSOMachineContext } from './QSOStateMachine.js';
import { ShadowSessionManager } from './ShadowSession.js';

/**
 * Events emitted by the QSO session engine.
 */
export interface QSOSessionEngineEvents {
  /** State changed */
  'stateChanged': (state: QSOState) => void;
  /** New QSO session started */
  'sessionStarted': (qsoId: string) => void;
  /** QSO session closed */
  'sessionClosed': (qsoId: string) => void;
  /** Turn processed */
  'turnProcessed': (turn: ProcessedTurn) => void;
}

/**
 * QSO Session Engine orchestrates the state machine, shadow sessions,
 * and turn processing for tracking QSO lifecycles.
 */
export class QSOSessionEngine extends EventEmitter<QSOSessionEngineEvents> {
  private actor: ReturnType<typeof createActor<typeof qsoStateMachine>>;
  private readonly shadowManager: ShadowSessionManager;
  private readonly myCallsign: string;
  private currentQsoId: string | null = null;
  private turns: ProcessedTurn[] = [];
  private trace: TraceEntry[] = [];
  private hasTxTurns: boolean = false;

  // Timers for silence/hold timeouts
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
    this.silenceTimeout = options.silenceTimeout ?? 15000; // 15s
    this.holdTimeout = options.holdTimeout ?? 120000; // 2 min
    this.shadowManager = new ShadowSessionManager();

    this.actor = createActor(qsoStateMachine);
    this.actor.subscribe(snapshot => {
      const state = snapshot.value as QSOState;
      this.emit('stateChanged', state);

      if (state === 'seeking' && !this.currentQsoId) {
        this.currentQsoId = uuidv4();
        this.emit('sessionStarted', this.currentQsoId);
      }
    });
  }

  /**
   * Start the engine.
   */
  start(): void {
    this.actor.start();
  }

  /**
   * Stop the engine.
   */
  stop(): void {
    this.clearTimers();
    this.actor.stop();
  }

  /**
   * Get the current state.
   */
  getState(): QSOState {
    return this.actor.getSnapshot().value as QSOState;
  }

  /**
   * Get the current context.
   */
  getContext(): QSOMachineContext {
    return this.actor.getSnapshot().context;
  }

  /**
   * Get current QSO ID.
   */
  getCurrentQsoId(): string | null {
    return this.currentQsoId;
  }

  /**
   * Get all turns for the current session.
   */
  getTurns(): ProcessedTurn[] {
    return [...this.turns];
  }

  /**
   * Get the decision trace.
   */
  getTrace(): TraceEntry[] {
    return [...this.trace];
  }

  /**
   * Get shadow sessions.
   */
  getShadowSessions() {
    return this.shadowManager.getAll();
  }

  /**
   * Process a new turn from the pipeline.
   */
  processTurn(turn: ProcessedTurn): void {
    this.turns.push(turn);
    if (turn.direction === 'tx') this.hasTxTurns = true;

    // Reset silence timer
    this.resetSilenceTimer();

    // Send TURN_RECEIVED event
    this.actor.send({ type: 'TURN_RECEIVED', turn });

    // Process callsign candidates
    for (const candidate of turn.features.callsignCandidates) {
      this.processCallsign(candidate, turn);
    }

    // Process closing signals
    if (turn.features.closingSignals.length > 0) {
      const maxScore = Math.max(...turn.features.closingSignals.map(s => s.confidence));
      this.actor.send({ type: 'CLOSING_DETECTED', score: maxScore });
      this.addTrace('rule', 'closing_detected', [`Score: ${maxScore}`], turn.id);
    }

    this.emit('turnProcessed', turn);

    // Check if dual callsigns are confirmed
    this.checkDualCallsigns();
  }

  /**
   * Notify the engine of a frequency change.
   */
  onFrequencyChanged(newFrequency: number): void {
    const currentState = this.getState();
    if (currentState !== 'idle') {
      this.actor.send({ type: 'FREQUENCY_CHANGED', newFrequency });
      this.addTrace('system', 'frequency_changed', [`New freq: ${newFrequency}`]);
      this.handleClosed();
    }
  }

  /**
   * Manually reset the session.
   */
  reset(): void {
    this.clearTimers();
    // Only send RESET if actor is not in a final state
    const state = this.getState();
    if (state !== 'closed') {
      this.actor.send({ type: 'RESET' });
    } else {
      // Recreate actor for a fresh session after closed state
      this.actor.stop();
      this.actor = createActor(qsoStateMachine);
      this.actor.subscribe(snapshot => {
        const s = snapshot.value as QSOState;
        this.emit('stateChanged', s);
        if (s === 'seeking' && !this.currentQsoId) {
          this.currentQsoId = uuidv4();
          this.emit('sessionStarted', this.currentQsoId);
        }
      });
      this.actor.start();
    }
    this.currentQsoId = null;
    this.turns = [];
    this.trace = [];
    this.hasTxTurns = false;
    this.shadowManager.clear();
  }

  private processCallsign(candidate: FieldCandidate<string>, turn: ProcessedTurn): void {
    const callsign = candidate.value.toUpperCase();
    const isMyCallsign = callsign === this.myCallsign;

    // For TX turns, speaker is known = myCallsign
    // For RX turns with TX present, speaker is likely the other party
    const speakerIsMe = turn.direction === 'tx' || isMyCallsign;

    if (!speakerIsMe) {
      // Check if this is a known callsign BEFORE sending to state machine
      const state = this.getState();
      const ctx = this.getContext();
      const isKnownCallsign = ctx.detectedCallsigns.some(c => c.callsign === callsign);

      // Track in shadow sessions if we're in locked state and it's a new callsign
      if (state === 'locked' && !isKnownCallsign) {
        this.shadowManager.report(callsign, candidate.confidence, turn.id);
        this.addTrace('rule', 'shadow_callsign_tracked', [
          `Callsign: ${callsign}`,
          `Confidence: ${candidate.confidence}`,
        ], turn.id);
      }

      // Send to state machine (this adds it to detectedCallsigns)
      this.actor.send({
        type: 'CALLSIGN_DETECTED',
        callsign,
        direction: turn.direction,
        confidence: candidate.confidence,
      });
    }

    this.addTrace('rule', 'callsign_processed', [
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

    // In participate mode (hasTxTurns), we need myCallsign + one other
    // In monitor mode (no TX), we need at least 2 different callsigns
    const uniqueCallsigns = new Set(ctx.detectedCallsigns.map(c => c.callsign));

    if (this.hasTxTurns) {
      // We know we're one party, just need one other callsign
      if (uniqueCallsigns.size >= 1) {
        this.actor.send({ type: 'DUAL_CALLSIGNS_CONFIRMED' });
        this.addTrace('rule', 'dual_callsigns_confirmed', [
          `Mode: participate`,
          `Callsigns: ${[...uniqueCallsigns].join(', ')}`,
        ]);
      }
    } else {
      // Monitor mode: need at least 2 distinct callsigns
      if (uniqueCallsigns.size >= 2) {
        this.actor.send({ type: 'DUAL_CALLSIGNS_CONFIRMED' });
        this.addTrace('rule', 'dual_callsigns_confirmed', [
          `Mode: monitor`,
          `Callsigns: ${[...uniqueCallsigns].join(', ')}`,
        ]);
      }
    }
  }

  private resetSilenceTimer(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    if (this.holdTimer) clearTimeout(this.holdTimer);

    this.silenceTimer = setTimeout(() => {
      const state = this.getState();
      if (state === 'seeking' || state === 'locked') {
        this.actor.send({ type: 'SILENCE_TIMEOUT' });

        if (state === 'locked') {
          // If moved to hold, start hold timer
          const newState = this.getState();
          if (newState === 'hold') {
            this.startHoldTimer();
          } else if (newState === 'closed') {
            this.handleClosed();
          }
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
    if (this.currentQsoId) {
      this.emit('sessionClosed', this.currentQsoId);
      this.addTrace('system', 'session_closed', [
        `QSO ID: ${this.currentQsoId}`,
        `Turns: ${this.turns.length}`,
      ]);
    }
  }

  private clearTimers(): void {
    if (this.silenceTimer) { clearTimeout(this.silenceTimer); this.silenceTimer = null; }
    if (this.holdTimer) { clearTimeout(this.holdTimer); this.holdTimer = null; }
  }

  private addTrace(
    actor: TraceEntry['actor'],
    action: string,
    reasons: string[],
    turnId?: string,
  ): void {
    this.trace.push({
      timestamp: Date.now(),
      actor,
      action,
      reasons,
      qsoId: this.currentQsoId ?? undefined,
      turnId,
    });
  }
}
