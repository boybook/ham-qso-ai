import { describe, it, expect } from 'vitest';
import { RuleBasedFeatureExtractor } from '../../../src/extraction/FeatureExtractor.js';

describe('RuleBasedFeatureExtractor', () => {
  const extractor = new RuleBasedFeatureExtractor();

  it('should extract callsigns, RST, and closing signals from a typical QSO turn', () => {
    const features = extractor.extract(
      'this is Whiskey One Alpha Whiskey you are five nine 73'
    );

    // Should find callsign W1AW
    expect(features.callsignCandidates.some(c => c.value === 'W1AW')).toBe(true);

    // Should find RST 59
    expect(features.rstCandidates.some(c => c.value === '59')).toBe(true);

    // Should find closing signal 73
    expect(features.closingSignals.length).toBeGreaterThan(0);
  });

  it('should extract CQ start signal', () => {
    const features = extractor.extract('CQ CQ CQ this is W1AW W1AW calling CQ');
    expect(features.qsoStartSignals.length).toBeGreaterThan(0);
    expect(features.callsignCandidates.some(c => c.value === 'W1AW')).toBe(true);
  });

  it('should extract continuation signals', () => {
    const features = extractor.extract('roger roger copy that go ahead');
    expect(features.continuationSignals.length).toBeGreaterThan(0);
  });

  it('should handle text with no features', () => {
    const features = extractor.extract('the weather is nice today');
    expect(features.callsignCandidates).toHaveLength(0);
    expect(features.rstCandidates).toHaveLength(0);
    expect(features.closingSignals).toHaveLength(0);
    expect(features.continuationSignals).toHaveLength(0);
    expect(features.qsoStartSignals).toHaveLength(0);
  });

  it('should handle empty text', () => {
    const features = extractor.extract('');
    expect(features.callsignCandidates).toHaveLength(0);
    expect(features.rstCandidates).toHaveLength(0);
  });
});
