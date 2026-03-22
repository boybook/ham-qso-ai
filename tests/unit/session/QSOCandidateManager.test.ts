import { describe, it, expect } from 'vitest';
import { QSOCandidateManager } from '../../../src/session/QSOCandidateManager.js';
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

function makeTurn(callsigns: string[] = [], direction: 'rx' | 'tx' = 'rx'): ProcessedTurn {
  return {
    id: `turn-${Math.random().toString(36).slice(2, 8)}`,
    direction,
    startTime: Date.now(),
    endTime: Date.now() + 3000,
    duration: 3000,
    audio: new Float32Array(0),
    sampleRate: 48000,
    text: '',
    asrConfidence: 0.9,
    asrProvider: 'test',
    features: {
      ...EMPTY_FEATURES,
      callsignCandidates: callsigns.map(cs => ({
        value: cs, confidence: 0.8, source: 'rule' as const, createdAt: Date.now(),
      })),
    },
  };
}

describe('QSOCandidateManager', () => {
  describe('routeTurn', () => {
    it('should create a new candidate for the first turn with callsign', () => {
      const mgr = new QSOCandidateManager({ myCallsign: 'BV2XMT' });
      const result = mgr.routeTurn(makeTurn(['W1AW']));

      expect(result.isNew).toBe(true);
      expect(result.candidate.hasCallsign('W1AW')).toBe(true);
      expect(result.candidate.isPrimary).toBe(true);
    });

    it('should route subsequent turns with same callsign to existing candidate', () => {
      const mgr = new QSOCandidateManager({ myCallsign: 'BV2XMT' });
      const r1 = mgr.routeTurn(makeTurn(['W1AW']));
      r1.candidate.addTurn(makeTurn(['W1AW'])); // feed the turn to build affinity

      const r2 = mgr.routeTurn(makeTurn(['W1AW']));
      expect(r2.isNew).toBe(false);
      expect(r2.candidate.id).toBe(r1.candidate.id);
    });

    it('should create a new candidate for a different callsign', () => {
      const mgr = new QSOCandidateManager({ myCallsign: 'BV2XMT' });
      const r1 = mgr.routeTurn(makeTurn(['W1AW']));
      r1.candidate.addTurn(makeTurn(['W1AW']));

      const r2 = mgr.routeTurn(makeTurn(['JA1ABC']));
      expect(r2.isNew).toBe(true);
      expect(r2.candidate.id).not.toBe(r1.candidate.id);
    });

    it('should route callsign-less turns to primary candidate', () => {
      const mgr = new QSOCandidateManager({ myCallsign: 'BV2XMT' });
      const r1 = mgr.routeTurn(makeTurn(['W1AW']));
      r1.candidate.addTurn(makeTurn(['W1AW']));

      const r2 = mgr.routeTurn(makeTurn([])); // no callsigns
      expect(r2.isNew).toBe(false);
      expect(r2.candidate.id).toBe(r1.candidate.id);
    });

    it('should filter out myCallsign from turn callsigns', () => {
      const mgr = new QSOCandidateManager({ myCallsign: 'BV2XMT' });
      // Turn only contains myCallsign — treated as no-callsign turn
      const r1 = mgr.routeTurn(makeTurn(['BV2XMT']));
      // Should create an empty candidate since no real counterpart
      expect(r1.isNew).toBe(true);
    });
  });

  describe('primary management', () => {
    it('should auto-assign first candidate as primary', () => {
      const mgr = new QSOCandidateManager({ myCallsign: 'BV2XMT' });
      mgr.routeTurn(makeTurn(['W1AW']));
      expect(mgr.getPrimary()?.hasCallsign('W1AW')).toBe(true);
    });

    it('should promote to primary manually', () => {
      const mgr = new QSOCandidateManager({ myCallsign: 'BV2XMT' });
      const r1 = mgr.routeTurn(makeTurn(['W1AW']));
      r1.candidate.addTurn(makeTurn(['W1AW']));

      const r2 = mgr.routeTurn(makeTurn(['JA1ABC']));
      mgr.promoteToPrimary(r2.candidate.id);

      expect(mgr.getPrimary()?.id).toBe(r2.candidate.id);
      expect(r1.candidate.isPrimary).toBe(false);
    });

    it('should auto-promote next best when primary is closed', () => {
      const mgr = new QSOCandidateManager({ myCallsign: 'BV2XMT' });
      const r1 = mgr.routeTurn(makeTurn(['W1AW']));
      r1.candidate.addTurn(makeTurn(['W1AW']));

      const r2 = mgr.routeTurn(makeTurn(['JA1ABC']));
      r2.candidate.addTurn(makeTurn(['JA1ABC']));

      mgr.closeCandidate(r1.candidate.id);
      expect(mgr.getPrimary()?.id).toBe(r2.candidate.id);
    });
  });

  describe('checkPromotion', () => {
    it('should promote candidate with higher evidence than primary', () => {
      const mgr = new QSOCandidateManager({ myCallsign: 'BV2XMT' });
      const r1 = mgr.routeTurn(makeTurn(['W1AW']));
      // Primary has 1 turn → low evidence

      const r2 = mgr.routeTurn(makeTurn(['JA1ABC']));
      r2.candidate.addTurn(makeTurn(['JA1ABC']));
      r2.candidate.addTurn(makeTurn(['JA1ABC'], 'tx'));
      r2.candidate.addTurn(makeTurn(['JA1ABC']));
      // Second candidate has 3+ turns → higher evidence

      const promoted = mgr.checkPromotion();
      expect(promoted?.id).toBe(r2.candidate.id);
      expect(mgr.getPrimary()?.id).toBe(r2.candidate.id);
    });
  });

  describe('prune', () => {
    it('should abandon excess candidates beyond maxCandidates', () => {
      const mgr = new QSOCandidateManager({ myCallsign: 'BV2XMT', maxCandidates: 2 });
      mgr.routeTurn(makeTurn(['W1AW']));
      mgr.routeTurn(makeTurn(['JA1ABC']));
      mgr.routeTurn(makeTurn(['VK3DEF']));

      const active = mgr.getActive();
      expect(active.length).toBeLessThanOrEqual(2);
    });
  });

  describe('clear', () => {
    it('should reset all state', () => {
      const mgr = new QSOCandidateManager({ myCallsign: 'BV2XMT' });
      mgr.routeTurn(makeTurn(['W1AW']));
      mgr.routeTurn(makeTurn(['JA1ABC']));

      mgr.clear();
      expect(mgr.getAll()).toHaveLength(0);
      expect(mgr.getPrimary()).toBeNull();
    });
  });

  describe('getAllInfo', () => {
    it('should return info for all candidates', () => {
      const mgr = new QSOCandidateManager({ myCallsign: 'BV2XMT' });
      mgr.routeTurn(makeTurn(['W1AW']));
      mgr.routeTurn(makeTurn(['JA1ABC']));

      const infos = mgr.getAllInfo();
      expect(infos).toHaveLength(2);
      expect(infos.some(i => i.callsigns.includes('W1AW'))).toBe(true);
      expect(infos.some(i => i.callsigns.includes('JA1ABC'))).toBe(true);
    });
  });
});
