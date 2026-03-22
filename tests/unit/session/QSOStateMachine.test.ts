import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import { qsoStateMachine, type QSOState } from '../../../src/session/QSOStateMachine.js';

function createTestActor() {
  const actor = createActor(qsoStateMachine);
  actor.start();
  return actor;
}

function getState(actor: ReturnType<typeof createTestActor>): QSOState {
  return actor.getSnapshot().value as QSOState;
}

describe('QSOStateMachine', () => {
  describe('initial state', () => {
    it('should start in idle', () => {
      const actor = createTestActor();
      expect(getState(actor)).toBe('idle');
      actor.stop();
    });
  });

  describe('idle → seeking', () => {
    it('should transition on CALLSIGN_DETECTED', () => {
      const actor = createTestActor();
      actor.send({ type: 'CALLSIGN_DETECTED', callsign: 'W1AW', direction: 'rx', confidence: 0.8 });
      expect(getState(actor)).toBe('seeking');
      expect(actor.getSnapshot().context.detectedCallsigns).toHaveLength(1);
      actor.stop();
    });
  });

  describe('seeking → locked', () => {
    it('should transition on DUAL_CALLSIGNS_CONFIRMED', () => {
      const actor = createTestActor();
      actor.send({ type: 'CALLSIGN_DETECTED', callsign: 'W1AW', direction: 'rx', confidence: 0.8 });
      actor.send({ type: 'DUAL_CALLSIGNS_CONFIRMED' });
      expect(getState(actor)).toBe('locked');
      expect(actor.getSnapshot().context.dualCallsignsConfirmed).toBe(true);
      actor.stop();
    });
  });

  describe('seeking → idle', () => {
    it('should return to idle on SILENCE_TIMEOUT', () => {
      const actor = createTestActor();
      actor.send({ type: 'CALLSIGN_DETECTED', callsign: 'W1AW', direction: 'rx', confidence: 0.8 });
      expect(getState(actor)).toBe('seeking');
      actor.send({ type: 'SILENCE_TIMEOUT' });
      expect(getState(actor)).toBe('idle');
      actor.stop();
    });

    it('should return to idle on FREQUENCY_CHANGED', () => {
      const actor = createTestActor();
      actor.send({ type: 'CALLSIGN_DETECTED', callsign: 'W1AW', direction: 'rx', confidence: 0.8 });
      actor.send({ type: 'FREQUENCY_CHANGED', newFrequency: 14200000 });
      expect(getState(actor)).toBe('idle');
      actor.stop();
    });
  });

  describe('locked → hold', () => {
    it('should go to hold on SILENCE_TIMEOUT when closing score is low', () => {
      const actor = createTestActor();
      actor.send({ type: 'CALLSIGN_DETECTED', callsign: 'W1AW', direction: 'rx', confidence: 0.8 });
      actor.send({ type: 'DUAL_CALLSIGNS_CONFIRMED' });
      expect(getState(actor)).toBe('locked');
      actor.send({ type: 'SILENCE_TIMEOUT' });
      expect(getState(actor)).toBe('hold');
      actor.stop();
    });
  });

  describe('locked → closed', () => {
    it('should close on SILENCE_TIMEOUT when closing score is high', () => {
      const actor = createTestActor();
      actor.send({ type: 'CALLSIGN_DETECTED', callsign: 'W1AW', direction: 'rx', confidence: 0.8 });
      actor.send({ type: 'DUAL_CALLSIGNS_CONFIRMED' });
      actor.send({ type: 'CLOSING_DETECTED', score: 0.9 });
      actor.send({ type: 'SILENCE_TIMEOUT' });
      expect(getState(actor)).toBe('closed');
      actor.stop();
    });

    it('should close on FREQUENCY_CHANGED', () => {
      const actor = createTestActor();
      actor.send({ type: 'CALLSIGN_DETECTED', callsign: 'W1AW', direction: 'rx', confidence: 0.8 });
      actor.send({ type: 'DUAL_CALLSIGNS_CONFIRMED' });
      actor.send({ type: 'FREQUENCY_CHANGED', newFrequency: 14200000 });
      expect(getState(actor)).toBe('closed');
      actor.stop();
    });
  });

  describe('hold transitions', () => {
    it('should return to locked on TURN_RECEIVED', () => {
      const actor = createTestActor();
      actor.send({ type: 'CALLSIGN_DETECTED', callsign: 'W1AW', direction: 'rx', confidence: 0.8 });
      actor.send({ type: 'DUAL_CALLSIGNS_CONFIRMED' });
      actor.send({ type: 'SILENCE_TIMEOUT' });
      expect(getState(actor)).toBe('hold');
      actor.send({ type: 'TURN_RECEIVED', turn: {} as any });
      expect(getState(actor)).toBe('locked');
      actor.stop();
    });

    it('should return to locked on ACTIVITY_RESUMED', () => {
      const actor = createTestActor();
      actor.send({ type: 'CALLSIGN_DETECTED', callsign: 'W1AW', direction: 'rx', confidence: 0.8 });
      actor.send({ type: 'DUAL_CALLSIGNS_CONFIRMED' });
      actor.send({ type: 'SILENCE_TIMEOUT' });
      actor.send({ type: 'ACTIVITY_RESUMED' });
      expect(getState(actor)).toBe('locked');
      actor.stop();
    });

    it('should close on HOLD_TIMEOUT', () => {
      const actor = createTestActor();
      actor.send({ type: 'CALLSIGN_DETECTED', callsign: 'W1AW', direction: 'rx', confidence: 0.8 });
      actor.send({ type: 'DUAL_CALLSIGNS_CONFIRMED' });
      actor.send({ type: 'SILENCE_TIMEOUT' });
      actor.send({ type: 'HOLD_TIMEOUT' });
      expect(getState(actor)).toBe('closed');
      actor.stop();
    });

    it('should close on FREQUENCY_CHANGED', () => {
      const actor = createTestActor();
      actor.send({ type: 'CALLSIGN_DETECTED', callsign: 'W1AW', direction: 'rx', confidence: 0.8 });
      actor.send({ type: 'DUAL_CALLSIGNS_CONFIRMED' });
      actor.send({ type: 'SILENCE_TIMEOUT' });
      actor.send({ type: 'FREQUENCY_CHANGED', newFrequency: 7100000 });
      expect(getState(actor)).toBe('closed');
      actor.stop();
    });
  });

  describe('RESET', () => {
    it('should return to idle from any state', () => {
      const actor = createTestActor();
      actor.send({ type: 'CALLSIGN_DETECTED', callsign: 'W1AW', direction: 'rx', confidence: 0.8 });
      actor.send({ type: 'DUAL_CALLSIGNS_CONFIRMED' });
      expect(getState(actor)).toBe('locked');
      actor.send({ type: 'RESET' });
      expect(getState(actor)).toBe('idle');
      actor.stop();
    });
  });

  describe('context updates', () => {
    it('should track multiple callsigns', () => {
      const actor = createTestActor();
      actor.send({ type: 'CALLSIGN_DETECTED', callsign: 'W1AW', direction: 'rx', confidence: 0.8 });
      actor.send({ type: 'CALLSIGN_DETECTED', callsign: 'JA1ABC', direction: 'rx', confidence: 0.7 });
      const ctx = actor.getSnapshot().context;
      expect(ctx.detectedCallsigns).toHaveLength(2);
      actor.stop();
    });

    it('should not duplicate same callsign', () => {
      const actor = createTestActor();
      actor.send({ type: 'CALLSIGN_DETECTED', callsign: 'W1AW', direction: 'rx', confidence: 0.8 });
      actor.send({ type: 'CALLSIGN_DETECTED', callsign: 'W1AW', direction: 'rx', confidence: 0.9 });
      const ctx = actor.getSnapshot().context;
      expect(ctx.detectedCallsigns).toHaveLength(1);
      actor.stop();
    });

    it('should increment turn count', () => {
      const actor = createTestActor();
      actor.send({ type: 'CALLSIGN_DETECTED', callsign: 'W1AW', direction: 'rx', confidence: 0.8 });
      actor.send({ type: 'TURN_RECEIVED', turn: {} as any });
      actor.send({ type: 'TURN_RECEIVED', turn: {} as any });
      expect(actor.getSnapshot().context.turnCount).toBe(2);
      actor.stop();
    });

    it('should reduce closing score on new turn in locked', () => {
      const actor = createTestActor();
      actor.send({ type: 'CALLSIGN_DETECTED', callsign: 'W1AW', direction: 'rx', confidence: 0.8 });
      actor.send({ type: 'DUAL_CALLSIGNS_CONFIRMED' });
      actor.send({ type: 'CLOSING_DETECTED', score: 0.8 });
      const before = actor.getSnapshot().context.closingScore;
      actor.send({ type: 'TURN_RECEIVED', turn: {} as any });
      const after = actor.getSnapshot().context.closingScore;
      expect(after).toBeLessThan(before);
      actor.stop();
    });
  });

  describe('interrupted state', () => {
    function toLocked(actor: ReturnType<typeof createTestActor>) {
      actor.send({ type: 'CALLSIGN_DETECTED', callsign: 'W1AW', direction: 'rx', confidence: 0.8 });
      actor.send({ type: 'DUAL_CALLSIGNS_CONFIRMED' });
    }

    it('should transition locked → interrupted on INTERRUPTION_DETECTED', () => {
      const actor = createTestActor();
      toLocked(actor);
      actor.send({ type: 'INTERRUPTION_DETECTED', interrupterCallsign: 'JA1ABC' });
      expect(getState(actor)).toBe('interrupted');
      expect(actor.getSnapshot().context.interrupterCallsign).toBe('JA1ABC');
      expect(actor.getSnapshot().context.interruptedCallsigns).toHaveLength(1);
      actor.stop();
    });

    it('should transition interrupted → resuming on INTERRUPTION_ENDED', () => {
      const actor = createTestActor();
      toLocked(actor);
      actor.send({ type: 'INTERRUPTION_DETECTED', interrupterCallsign: 'JA1ABC' });
      actor.send({ type: 'INTERRUPTION_ENDED' });
      expect(getState(actor)).toBe('resuming');
      actor.stop();
    });

    it('should transition interrupted → hold on SILENCE_TIMEOUT', () => {
      const actor = createTestActor();
      toLocked(actor);
      actor.send({ type: 'INTERRUPTION_DETECTED', interrupterCallsign: 'JA1ABC' });
      actor.send({ type: 'SILENCE_TIMEOUT' });
      expect(getState(actor)).toBe('hold');
      actor.stop();
    });

    it('should transition interrupted → closed on FREQUENCY_CHANGED', () => {
      const actor = createTestActor();
      toLocked(actor);
      actor.send({ type: 'INTERRUPTION_DETECTED', interrupterCallsign: 'JA1ABC' });
      actor.send({ type: 'FREQUENCY_CHANGED', newFrequency: 7100000 });
      expect(getState(actor)).toBe('closed');
      actor.stop();
    });
  });

  describe('resuming state', () => {
    function toResuming(actor: ReturnType<typeof createTestActor>) {
      actor.send({ type: 'CALLSIGN_DETECTED', callsign: 'W1AW', direction: 'rx', confidence: 0.8 });
      actor.send({ type: 'DUAL_CALLSIGNS_CONFIRMED' });
      actor.send({ type: 'INTERRUPTION_DETECTED', interrupterCallsign: 'JA1ABC' });
      actor.send({ type: 'INTERRUPTION_ENDED' });
    }

    it('should transition resuming → locked on TURN_RECEIVED', () => {
      const actor = createTestActor();
      toResuming(actor);
      actor.send({ type: 'TURN_RECEIVED', turn: {} as any });
      expect(getState(actor)).toBe('locked');
      // Should restore pre-interruption callsigns
      expect(actor.getSnapshot().context.interrupterCallsign).toBe('');
      actor.stop();
    });

    it('should transition resuming → hold on SILENCE_TIMEOUT', () => {
      const actor = createTestActor();
      toResuming(actor);
      actor.send({ type: 'SILENCE_TIMEOUT' });
      expect(getState(actor)).toBe('hold');
      actor.stop();
    });

    it('should transition resuming → closed on FREQUENCY_CHANGED', () => {
      const actor = createTestActor();
      toResuming(actor);
      actor.send({ type: 'FREQUENCY_CHANGED', newFrequency: 7100000 });
      expect(getState(actor)).toBe('closed');
      actor.stop();
    });
  });
});
