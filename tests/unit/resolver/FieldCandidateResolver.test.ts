import { describe, it, expect } from 'vitest';
import { FieldCandidateResolver } from '../../../src/resolver/FieldCandidateResolver.js';
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
    id: 'turn-1',
    direction: 'rx',
    startTime: 1000,
    endTime: 4000,
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

describe('FieldCandidateResolver', () => {
  it('should resolve callsign from RX turn', () => {
    const resolver = new FieldCandidateResolver('BV2XMT');
    resolver.updateMetadata(14200000, 'USB');

    resolver.processTurn(makeTurn({
      features: {
        ...makeTurn().features,
        callsignCandidates: [{
          value: 'W1AW', confidence: 0.8, source: 'rule', createdAt: Date.now(),
        }],
      },
    }));

    const fields = resolver.resolve();
    expect(fields.theirCallsign.value).toBe('W1AW');
    expect(fields.theirCallsign.confidence).toBeGreaterThan(0);
  });

  it('should not put myCallsign into theirCallsign pool', () => {
    const resolver = new FieldCandidateResolver('BV2XMT');

    resolver.processTurn(makeTurn({
      features: {
        ...makeTurn().features,
        callsignCandidates: [{
          value: 'BV2XMT', confidence: 0.9, source: 'rule', createdAt: Date.now(),
        }],
      },
    }));

    const fields = resolver.resolve();
    expect(fields.theirCallsign.value).not.toBe('BV2XMT');
  });

  it('should assign RST to sent pool for TX turns', () => {
    const resolver = new FieldCandidateResolver('BV2XMT');

    resolver.processTurn(makeTurn({
      direction: 'tx',
      features: {
        ...makeTurn().features,
        rstCandidates: [{
          value: '59', confidence: 0.8, source: 'rule', createdAt: Date.now(),
        }],
      },
    }));

    const fields = resolver.resolve();
    expect(fields.rstSent.value).toBe('59');
  });

  it('should assign RST to received pool for RX turns in participate mode', () => {
    const resolver = new FieldCandidateResolver('BV2XMT');

    // TX turn first to establish participate mode
    resolver.processTurn(makeTurn({ direction: 'tx' }));

    // RX turn with RST
    resolver.processTurn(makeTurn({
      direction: 'rx',
      features: {
        ...makeTurn().features,
        rstCandidates: [{
          value: '57', confidence: 0.7, source: 'rule', createdAt: Date.now(),
        }],
      },
    }));

    const fields = resolver.resolve();
    expect(fields.rstReceived.value).toBe('57');
  });

  it('should resolve metadata fields from updateMetadata', () => {
    const resolver = new FieldCandidateResolver('BV2XMT');
    resolver.updateMetadata(14200000, 'USB');

    const fields = resolver.resolve();
    expect(fields.frequency.value).toBe(14200000);
    expect(fields.frequency.confidence).toBe(1.0);
    expect(fields.mode.value).toBe('USB');
    expect(fields.myCallsign.value).toBe('BV2XMT');
  });

  it('should track start and end times', () => {
    const resolver = new FieldCandidateResolver('BV2XMT');

    resolver.processTurn(makeTurn({ startTime: 1000, endTime: 4000 }));
    resolver.processTurn(makeTurn({ startTime: 5000, endTime: 8000 }));

    const fields = resolver.resolve();
    expect(fields.startTime.value).toBe(1000);
    expect(fields.endTime?.value).toBe(8000);
  });

  it('should report ready when key fields are resolved', () => {
    const resolver = new FieldCandidateResolver('BV2XMT');
    resolver.updateMetadata(14200000, 'USB');

    expect(resolver.isReady()).toBe(false);

    resolver.processTurn(makeTurn({
      features: {
        ...makeTurn().features,
        callsignCandidates: [{
          value: 'W1AW', confidence: 0.8, source: 'rule', createdAt: Date.now(),
        }],
      },
    }));

    expect(resolver.isReady()).toBe(true);
  });

  it('should default RST to 59 with low confidence when not detected', () => {
    const resolver = new FieldCandidateResolver('BV2XMT');
    const fields = resolver.resolve();
    expect(fields.rstSent.value).toBe('59');
    expect(fields.rstSent.confidence).toBeLessThan(0.5);
  });

  it('should clear properly', () => {
    const resolver = new FieldCandidateResolver('BV2XMT');
    resolver.processTurn(makeTurn({
      features: {
        ...makeTurn().features,
        callsignCandidates: [{
          value: 'W1AW', confidence: 0.8, source: 'rule', createdAt: Date.now(),
        }],
      },
    }));

    resolver.clear();
    const fields = resolver.resolve();
    expect(fields.theirCallsign.value).toBe('');
  });
});
