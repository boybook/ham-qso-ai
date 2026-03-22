import { describe, it, expect } from 'vitest';
import { QSOCandidate } from '../../../src/session/QSOCandidate.js';
import type { ProcessedTurn, TurnFeatures } from '../../../src/types/turn.js';

const EMPTY_FEATURES: TurnFeatures = {
  callsignCandidates: [],
  rstCandidates: [],
  nameCandidates: [],
  qthCandidates: [],
  gridCandidates: [],
  closingSignals: [],
  continuationSignals: [],
  qsoStartSignals: [],
};

function makeTurn(overrides: Partial<ProcessedTurn> = {}): ProcessedTurn {
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
    features: EMPTY_FEATURES,
    ...overrides,
  };
}

describe('QSOCandidate', () => {
  it('should initialize with candidate status', () => {
    const c = new QSOCandidate('BV2XMT');
    expect(c.getStatus()).toBe('candidate');
    expect(c.turnCount).toBe(0);
    expect(c.isPrimary).toBe(false);
  });

  it('should register initial callsign', () => {
    const c = new QSOCandidate('BV2XMT', 'W1AW');
    expect(c.hasCallsign('W1AW')).toBe(true);
    expect(c.hasCallsign('JA1ABC')).toBe(false);
  });

  it('should add turns and update state', () => {
    const c = new QSOCandidate('BV2XMT');
    const turn = makeTurn({
      direction: 'tx',
      features: {
        ...EMPTY_FEATURES,
        callsignCandidates: [{ value: 'W1AW', confidence: 0.8, source: 'rule', createdAt: Date.now() }],
      },
    });

    c.addTurn(turn);
    expect(c.turnCount).toBe(1);
    expect(c.hasTxTurns).toBe(true);
    expect(c.hasCallsign('W1AW')).toBe(true);
  });

  it('should not register myCallsign as their callsign', () => {
    const c = new QSOCandidate('BV2XMT');
    c.addTurn(makeTurn({
      features: {
        ...EMPTY_FEATURES,
        callsignCandidates: [{ value: 'BV2XMT', confidence: 0.9, source: 'rule', createdAt: Date.now() }],
      },
    }));
    expect(c.hasCallsign('BV2XMT')).toBe(false);
  });

  it('should track closing score', () => {
    const c = new QSOCandidate('BV2XMT');
    c.addTurn(makeTurn({
      features: {
        ...EMPTY_FEATURES,
        closingSignals: [{ type: 'farewell', matchedText: '73', position: 0, confidence: 0.9 }],
      },
    }));
    expect(c.closingScore).toBe(0.9);

    // New non-closing turn reduces score
    c.addTurn(makeTurn());
    expect(c.closingScore).toBeLessThan(0.9);
  });

  it('should compute evidence score based on callsigns, turns, and tx', () => {
    const c = new QSOCandidate('BV2XMT', 'W1AW');
    expect(c.getEvidenceScore()).toBeGreaterThan(0);

    // Add turns to increase evidence
    c.addTurn(makeTurn({ direction: 'tx' }));
    c.addTurn(makeTurn());
    const score = c.getEvidenceScore();
    expect(score).toBeGreaterThan(0.3);
  });

  describe('scoreAffinity', () => {
    it('should score high for turns mentioning known callsigns', () => {
      const c = new QSOCandidate('BV2XMT', 'W1AW');
      const turn = makeTurn({
        features: {
          ...EMPTY_FEATURES,
          callsignCandidates: [{ value: 'W1AW', confidence: 0.8, source: 'rule', createdAt: Date.now() }],
        },
      });
      expect(c.scoreAffinity(turn)).toBeGreaterThanOrEqual(0.6);
    });

    it('should score low for turns mentioning unknown callsigns', () => {
      const c = new QSOCandidate('BV2XMT', 'W1AW');
      const turn = makeTurn({
        features: {
          ...EMPTY_FEATURES,
          callsignCandidates: [{ value: 'JA1ABC', confidence: 0.8, source: 'rule', createdAt: Date.now() }],
        },
      });
      expect(c.scoreAffinity(turn)).toBeLessThan(0.4);
    });

    it('should give medium score to turns with no callsigns when primary', () => {
      const c = new QSOCandidate('BV2XMT', 'W1AW');
      c.isPrimary = true;
      const turn = makeTurn(); // no callsigns
      expect(c.scoreAffinity(turn)).toBeGreaterThan(0.1);
    });
  });

  describe('lifecycle', () => {
    it('should promote from candidate to active', () => {
      const c = new QSOCandidate('BV2XMT');
      c.promote();
      expect(c.getStatus()).toBe('active');
    });

    it('should close', () => {
      const c = new QSOCandidate('BV2XMT');
      c.promote();
      c.close();
      expect(c.getStatus()).toBe('closed');
    });

    it('should abandon', () => {
      const c = new QSOCandidate('BV2XMT');
      c.abandon();
      expect(c.getStatus()).toBe('abandoned');
    });
  });

  it('should resolve fields via internal resolver', () => {
    const c = new QSOCandidate('BV2XMT');
    c.updateMetadata(14200000, 'USB');
    c.addTurn(makeTurn({
      features: {
        ...EMPTY_FEATURES,
        callsignCandidates: [{ value: 'W1AW', confidence: 0.8, source: 'rule', createdAt: Date.now() }],
        rstCandidates: [{ value: '59', confidence: 0.7, source: 'rule', createdAt: Date.now() }],
      },
    }));

    const fields = c.resolveFields();
    expect(fields.theirCallsign.value).toBe('W1AW');
    expect(fields.frequency.value).toBe(14200000);
    expect(fields.myCallsign.value).toBe('BV2XMT');
  });

  it('should return info snapshot', () => {
    const c = new QSOCandidate('BV2XMT', 'W1AW');
    c.addTurn(makeTurn());
    const info = c.getInfo();
    expect(info.callsigns).toContain('W1AW');
    expect(info.turnCount).toBe(1);
    expect(info.status).toBe('candidate');
  });
});
