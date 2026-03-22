import { setup, createActor } from 'xstate';
import type { ProcessedTurn } from '../types/turn.js';

/**
 * QSO session states.
 *
 * State diagram:
 * ```
 * idle → seeking → locked ⇌ hold → closed
 *                    ↕
 *               interrupted → resuming → locked
 * ```
 */
export type QSOState =
  | 'idle'
  | 'seeking'
  | 'locked'
  | 'hold'
  | 'interrupted'
  | 'resuming'
  | 'closed';

/**
 * Events that drive the QSO state machine.
 */
export type QSOEvent =
  | { type: 'CALLSIGN_DETECTED'; callsign: string; direction: 'rx' | 'tx'; confidence: number }
  | { type: 'DUAL_CALLSIGNS_CONFIRMED' }
  | { type: 'TURN_RECEIVED'; turn: ProcessedTurn }
  | { type: 'CLOSING_DETECTED'; score: number }
  | { type: 'SILENCE_TIMEOUT' }
  | { type: 'HOLD_TIMEOUT' }
  | { type: 'FREQUENCY_CHANGED'; newFrequency: number }
  | { type: 'ACTIVITY_RESUMED' }
  | { type: 'INTERRUPTION_DETECTED'; interrupterCallsign: string }
  | { type: 'INTERRUPTION_ENDED' }
  | { type: 'PTT_CHANGED'; active: boolean }
  | { type: 'MODE_CHANGED'; newMode: string }
  | { type: 'RESET' };

/**
 * Context maintained by the QSO state machine.
 */
export interface QSOMachineContext {
  /** Detected callsigns with directions */
  detectedCallsigns: Array<{ callsign: string; direction: 'rx' | 'tx'; confidence: number }>;
  /** Whether both sides have been identified */
  dualCallsignsConfirmed: boolean;
  /** Last activity timestamp */
  lastActivityAt: number;
  /** QSO start time */
  startedAt: number;
  /** Closing score (0-1) */
  closingScore: number;
  /** Turn count */
  turnCount: number;
  /** Current frequency */
  frequency: number;
  /** Callsigns snapshot before interruption (for resuming) */
  interruptedCallsigns: Array<{ callsign: string; direction: 'rx' | 'tx'; confidence: number }>;
  /** Callsign of the interrupter */
  interrupterCallsign: string;
}

const initialContext: QSOMachineContext = {
  detectedCallsigns: [],
  dualCallsignsConfirmed: false,
  lastActivityAt: 0,
  startedAt: 0,
  closingScore: 0,
  turnCount: 0,
  frequency: 0,
  interruptedCallsigns: [],
  interrupterCallsign: '',
};

/**
 * XState v5 machine definition for QSO session tracking.
 */
export const qsoStateMachine = setup({
  types: {
    context: {} as QSOMachineContext,
    events: {} as QSOEvent,
  },
}).createMachine({
  id: 'qso',
  initial: 'idle',
  context: initialContext,
  states: {
    idle: {
      on: {
        CALLSIGN_DETECTED: {
          target: 'seeking',
          actions: ({ context, event }) => {
            context.detectedCallsigns = [{
              callsign: event.callsign,
              direction: event.direction,
              confidence: event.confidence,
            }];
            context.startedAt = Date.now();
            context.lastActivityAt = Date.now();
            context.closingScore = 0;
            context.turnCount = 0;
            context.dualCallsignsConfirmed = false;
            context.interruptedCallsigns = [];
            context.interrupterCallsign = '';
          },
        },
      },
    },

    seeking: {
      on: {
        CALLSIGN_DETECTED: {
          actions: ({ context, event }) => {
            const existing = context.detectedCallsigns.find(c => c.callsign === event.callsign);
            if (!existing) {
              context.detectedCallsigns.push({
                callsign: event.callsign,
                direction: event.direction,
                confidence: event.confidence,
              });
            }
            context.lastActivityAt = Date.now();
          },
        },
        DUAL_CALLSIGNS_CONFIRMED: {
          target: 'locked',
          actions: ({ context }) => {
            context.dualCallsignsConfirmed = true;
            context.lastActivityAt = Date.now();
          },
        },
        TURN_RECEIVED: {
          actions: ({ context }) => {
            context.turnCount++;
            context.lastActivityAt = Date.now();
          },
        },
        SILENCE_TIMEOUT: {
          target: 'idle',
          actions: ({ context }) => {
            context.detectedCallsigns = [];
            context.dualCallsignsConfirmed = false;
          },
        },
        FREQUENCY_CHANGED: {
          target: 'idle',
          actions: ({ context, event }) => {
            context.frequency = event.newFrequency;
            context.detectedCallsigns = [];
            context.dualCallsignsConfirmed = false;
          },
        },
        RESET: {
          target: 'idle',
          actions: ({ context }) => { Object.assign(context, initialContext); },
        },
      },
    },

    locked: {
      on: {
        TURN_RECEIVED: {
          actions: ({ context }) => {
            context.turnCount++;
            context.lastActivityAt = Date.now();
            context.closingScore = Math.max(0, context.closingScore - 0.2);
          },
        },
        CALLSIGN_DETECTED: {
          actions: ({ context, event }) => {
            const existing = context.detectedCallsigns.find(c => c.callsign === event.callsign);
            if (!existing) {
              context.detectedCallsigns.push({
                callsign: event.callsign,
                direction: event.direction,
                confidence: event.confidence,
              });
            }
            context.lastActivityAt = Date.now();
          },
        },
        CLOSING_DETECTED: {
          actions: ({ context, event }) => {
            context.closingScore = Math.max(context.closingScore, event.score);
          },
        },
        SILENCE_TIMEOUT: [
          {
            guard: ({ context }) => context.closingScore >= 0.7,
            target: 'closed',
          },
          {
            target: 'hold',
          },
        ],
        INTERRUPTION_DETECTED: {
          target: 'interrupted',
          actions: ({ context, event }) => {
            // Snapshot current callsigns before interruption
            context.interruptedCallsigns = [...context.detectedCallsigns];
            context.interrupterCallsign = event.interrupterCallsign;
            context.lastActivityAt = Date.now();
          },
        },
        FREQUENCY_CHANGED: {
          target: 'closed',
          actions: ({ context, event }) => { context.frequency = event.newFrequency; },
        },
        RESET: {
          target: 'idle',
          actions: ({ context }) => { Object.assign(context, initialContext); },
        },
      },
    },

    interrupted: {
      on: {
        INTERRUPTION_ENDED: {
          target: 'resuming',
          actions: ({ context }) => {
            context.lastActivityAt = Date.now();
          },
        },
        TURN_RECEIVED: {
          actions: ({ context }) => {
            context.turnCount++;
            context.lastActivityAt = Date.now();
          },
        },
        SILENCE_TIMEOUT: {
          target: 'hold',
        },
        FREQUENCY_CHANGED: {
          target: 'closed',
          actions: ({ context, event }) => { context.frequency = event.newFrequency; },
        },
        RESET: {
          target: 'idle',
          actions: ({ context }) => { Object.assign(context, initialContext); },
        },
      },
    },

    resuming: {
      on: {
        TURN_RECEIVED: {
          target: 'locked',
          actions: ({ context }) => {
            // Restore pre-interruption callsigns
            context.detectedCallsigns = [...context.interruptedCallsigns];
            context.interruptedCallsigns = [];
            context.interrupterCallsign = '';
            context.turnCount++;
            context.lastActivityAt = Date.now();
          },
        },
        SILENCE_TIMEOUT: {
          target: 'hold',
        },
        FREQUENCY_CHANGED: {
          target: 'closed',
          actions: ({ context, event }) => { context.frequency = event.newFrequency; },
        },
        RESET: {
          target: 'idle',
          actions: ({ context }) => { Object.assign(context, initialContext); },
        },
      },
    },

    hold: {
      on: {
        TURN_RECEIVED: {
          target: 'locked',
          actions: ({ context }) => {
            context.turnCount++;
            context.lastActivityAt = Date.now();
          },
        },
        ACTIVITY_RESUMED: {
          target: 'locked',
          actions: ({ context }) => {
            context.lastActivityAt = Date.now();
          },
        },
        HOLD_TIMEOUT: {
          target: 'closed',
        },
        FREQUENCY_CHANGED: {
          target: 'closed',
          actions: ({ context, event }) => { context.frequency = event.newFrequency; },
        },
        RESET: {
          target: 'idle',
          actions: ({ context }) => { Object.assign(context, initialContext); },
        },
      },
    },

    closed: {
      type: 'final',
    },
  },
});

/**
 * Create a new QSO state machine actor.
 */
export function createQSOActor() {
  return createActor(qsoStateMachine);
}

/**
 * Get frequency change threshold based on operating mode.
 */
export function getFrequencyChangeThreshold(mode: string): number {
  switch (mode.toUpperCase()) {
    case 'FM':  return 12500; // FM channel spacing
    case 'AM':  return 5000;
    case 'USB':
    case 'LSB': return 1000;  // SSB
    case 'CW':  return 500;
    default:    return 1000;
  }
}
