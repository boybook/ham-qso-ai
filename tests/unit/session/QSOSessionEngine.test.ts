import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QSOSessionEngine } from '../../../src/session/QSOSessionEngine.js';
import type { ProcessedTurn, TurnFeatures } from '../../../src/types/turn.js';

function makeTurn(overrides: Partial<ProcessedTurn> = {}): ProcessedTurn {
  const defaultFeatures: TurnFeatures = {
    callsignCandidates: [],
    rstCandidates: [],
    nameCandidates: [],
    qthCandidates: [],
    gridCandidates: [],
    closingSignals: [],
    continuationSignals: [],
    qsoStartSignals: [],
  };

  return {
    id: `turn-${Math.random().toString(36).slice(2, 8)}`,
    direction: 'rx',
    startTime: Date.now(),
    endTime: Date.now() + 3000,
    duration: 3000,
    audio: new Float32Array(0),
    sampleRate: 48000,
    text: '',
    asrConfidence: 0.9,
    asrProvider: 'test',
    features: defaultFeatures,
    ...overrides,
  };
}

describe('QSOSessionEngine', () => {
  let engine: QSOSessionEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    engine = new QSOSessionEngine({
      myCallsign: 'BV2XMT',
      silenceTimeout: 5000,
      holdTimeout: 10000,
    });
    engine.start();
  });

  afterEach(() => {
    engine.stop();
    vi.useRealTimers();
  });

  it('should start in idle state', () => {
    expect(engine.getState()).toBe('idle');
  });

  it('should transition to seeking when a callsign is detected', () => {
    const turn = makeTurn({
      features: {
        ...makeTurn().features,
        callsignCandidates: [{
          value: 'W1AW', confidence: 0.8, source: 'rule',
          createdAt: Date.now(),
        }],
      },
    });

    engine.processTurn(turn);
    expect(engine.getState()).toBe('seeking');
  });

  it('should transition to locked in participate mode (TX + RX callsign)', () => {
    // TX turn (our own transmission)
    const txTurn = makeTurn({
      direction: 'tx',
      text: 'CQ CQ this is BV2XMT',
    });
    engine.processTurn(txTurn);

    // RX turn with other callsign
    const rxTurn = makeTurn({
      direction: 'rx',
      text: 'W1AW calling',
      features: {
        ...makeTurn().features,
        callsignCandidates: [{
          value: 'W1AW', confidence: 0.8, source: 'rule',
          createdAt: Date.now(),
        }],
      },
    });
    engine.processTurn(rxTurn);

    // In participate mode, one other callsign is enough
    expect(engine.getState()).toBe('locked');
  });

  it('should transition to locked in monitor mode (2 callsigns detected)', () => {
    // RX turn with first callsign
    const rxTurn1 = makeTurn({
      direction: 'rx',
      features: {
        ...makeTurn().features,
        callsignCandidates: [{
          value: 'W1AW', confidence: 0.8, source: 'rule',
          createdAt: Date.now(),
        }],
      },
    });
    engine.processTurn(rxTurn1);
    expect(engine.getState()).toBe('seeking');

    // RX turn with second callsign
    const rxTurn2 = makeTurn({
      direction: 'rx',
      features: {
        ...makeTurn().features,
        callsignCandidates: [{
          value: 'JA1ABC', confidence: 0.7, source: 'rule',
          createdAt: Date.now(),
        }],
      },
    });
    engine.processTurn(rxTurn2);
    expect(engine.getState()).toBe('locked');
  });

  it('should emit sessionStarted when transitioning to locked (not seeking)', () => {
    const startedSpy = vi.fn();
    engine.on('sessionStarted', startedSpy);

    // First turn: seeking state — no sessionStarted yet
    const txTurn = makeTurn({ direction: 'tx' });
    engine.processTurn(txTurn);
    expect(startedSpy).not.toHaveBeenCalled();

    // Second turn with callsign: locked state — sessionStarted emitted
    const rxTurn = makeTurn({
      features: {
        ...makeTurn().features,
        callsignCandidates: [{
          value: 'W1AW', confidence: 0.8, source: 'rule',
          createdAt: Date.now(),
        }],
      },
    });
    engine.processTurn(rxTurn);
    expect(engine.getState()).toBe('locked');
    expect(startedSpy).toHaveBeenCalledOnce();
    expect(engine.getCurrentQsoId()).toBeTruthy();
  });

  it('should go to hold after silence timeout in locked', () => {
    // Get to locked state
    const txTurn = makeTurn({ direction: 'tx' });
    engine.processTurn(txTurn);

    const rxTurn = makeTurn({
      features: {
        ...makeTurn().features,
        callsignCandidates: [{
          value: 'W1AW', confidence: 0.8, source: 'rule',
          createdAt: Date.now(),
        }],
      },
    });
    engine.processTurn(rxTurn);
    expect(engine.getState()).toBe('locked');

    // Advance time past silence timeout
    vi.advanceTimersByTime(6000);
    expect(engine.getState()).toBe('hold');
  });

  it('should close after closing signal + silence timeout', () => {
    const closedSpy = vi.fn();
    engine.on('sessionClosed', closedSpy);

    // Get to locked
    const txTurn = makeTurn({ direction: 'tx' });
    engine.processTurn(txTurn);

    const rxTurn = makeTurn({
      features: {
        ...makeTurn().features,
        callsignCandidates: [{
          value: 'W1AW', confidence: 0.8, source: 'rule',
          createdAt: Date.now(),
        }],
      },
    });
    engine.processTurn(rxTurn);

    // Closing signal
    const closingTurn = makeTurn({
      features: {
        ...makeTurn().features,
        closingSignals: [{
          type: 'farewell', matchedText: '73',
          position: 0, confidence: 0.9,
        }],
      },
    });
    engine.processTurn(closingTurn);

    // Silence timeout
    vi.advanceTimersByTime(6000);
    expect(engine.getState()).toBe('closed');
    expect(closedSpy).toHaveBeenCalledOnce();
  });

  it('should track turns', () => {
    const turn1 = makeTurn();
    const turn2 = makeTurn();
    engine.processTurn(turn1);
    engine.processTurn(turn2);
    expect(engine.getTurns()).toHaveLength(2);
  });

  it('should maintain trace entries', () => {
    const turn = makeTurn({
      features: {
        ...makeTurn().features,
        callsignCandidates: [{
          value: 'W1AW', confidence: 0.8, source: 'rule',
          createdAt: Date.now(),
        }],
      },
    });
    engine.processTurn(turn);
    expect(engine.getTrace().length).toBeGreaterThan(0);
  });

  it('should handle frequency change by closing session', () => {
    const closedSpy = vi.fn();
    engine.on('sessionClosed', closedSpy);

    // Get to locked
    const txTurn = makeTurn({ direction: 'tx' });
    engine.processTurn(txTurn);

    const rxTurn = makeTurn({
      features: {
        ...makeTurn().features,
        callsignCandidates: [{
          value: 'W1AW', confidence: 0.8, source: 'rule',
          createdAt: Date.now(),
        }],
      },
    });
    engine.processTurn(rxTurn);

    engine.onFrequencyChanged(7100000);
    expect(engine.getState()).toBe('closed');
    expect(closedSpy).toHaveBeenCalledOnce();
  });

  it('should reset properly', () => {
    const turn = makeTurn({
      features: {
        ...makeTurn().features,
        callsignCandidates: [{
          value: 'W1AW', confidence: 0.8, source: 'rule',
          createdAt: Date.now(),
        }],
      },
    });
    engine.processTurn(turn);
    expect(engine.getState()).toBe('seeking');

    engine.reset();
    expect(engine.getState()).toBe('idle');
    expect(engine.getTurns()).toHaveLength(0);
    expect(engine.getCurrentQsoId()).toBeNull();
  });

  it('should create a new candidate for third-party callsign in locked state', () => {
    // Get to locked
    const txTurn = makeTurn({ direction: 'tx' });
    engine.processTurn(txTurn);

    const rxTurn = makeTurn({
      features: {
        ...makeTurn().features,
        callsignCandidates: [{
          value: 'W1AW', confidence: 0.8, source: 'rule',
          createdAt: Date.now(),
        }],
      },
    });
    engine.processTurn(rxTurn);
    expect(engine.getState()).toBe('locked');

    // Third party callsign → creates a new candidate and triggers interruption
    const thirdPartyTurn = makeTurn({
      features: {
        ...makeTurn().features,
        callsignCandidates: [{
          value: 'JA1ABC', confidence: 0.7, source: 'rule',
          createdAt: Date.now(),
        }],
      },
    });
    engine.processTurn(thirdPartyTurn);

    // Should have multiple candidates
    const candidates = engine.getCandidates();
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates.some(c => c.callsigns.includes('JA1ABC'))).toBe(true);

    // Should have triggered interruption
    expect(engine.getState()).toBe('interrupted');
  });
});
