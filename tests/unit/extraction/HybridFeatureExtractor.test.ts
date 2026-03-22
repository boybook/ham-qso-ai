import { describe, it, expect, vi } from 'vitest';
import { HybridFeatureExtractor } from '../../../src/extraction/HybridFeatureExtractor.js';
import type { IFeatureExtractor } from '../../../src/extraction/FeatureExtractor.js';
import type { TurnFeatures } from '../../../src/types/turn.js';

const EMPTY: TurnFeatures = {
  callsignCandidates: [],
  rstCandidates: [],
  nameCandidates: [],
  qthCandidates: [],
  gridCandidates: [],
  closingSignals: [],
  continuationSignals: [],
  qsoStartSignals: [],
};

function mockExtractor(result: Partial<TurnFeatures>): IFeatureExtractor & { calls: number } {
  const mock = {
    calls: 0,
    extract: vi.fn(async () => {
      mock.calls++;
      return { ...EMPTY, ...result };
    }),
  };
  return mock;
}

describe('HybridFeatureExtractor', () => {
  describe('LLM triggering logic', () => {
    it('should NOT call LLM when rules extract callsign + RST', async () => {
      const rules = mockExtractor({
        callsignCandidates: [{ value: 'W1AW', confidence: 0.8, source: 'rule', createdAt: Date.now() }],
        rstCandidates: [{ value: '59', confidence: 0.7, source: 'rule', createdAt: Date.now() }],
      });
      const llm = mockExtractor({});

      const hybrid = new HybridFeatureExtractor(rules, llm);
      await hybrid.extract('this is W1AW you are 59');

      expect(rules.calls).toBe(1);
      expect(llm.calls).toBe(0); // LLM NOT called
    });

    it('should NOT call LLM when rules extract callsign only (RST not in every turn)', async () => {
      const rules = mockExtractor({
        callsignCandidates: [{ value: 'W1AW', confidence: 0.8, source: 'rule', createdAt: Date.now() }],
      });
      const llm = mockExtractor({});

      const hybrid = new HybridFeatureExtractor(rules, llm);
      await hybrid.extract('W1AW calling');

      expect(llm.calls).toBe(0); // Has callsign, no RST is OK
    });

    it('should NOT call LLM when rules detect only signals (roger/73)', async () => {
      const rules = mockExtractor({
        continuationSignals: [{ type: 'acknowledgment', matchedText: 'roger', position: 0, confidence: 0.7 }],
      });
      const llm = mockExtractor({});

      const hybrid = new HybridFeatureExtractor(rules, llm);
      await hybrid.extract('roger roger');

      expect(llm.calls).toBe(0); // Signal-only turn, no LLM needed
    });

    it('should call LLM when rules find nothing (no callsign, no RST, no signals)', async () => {
      const rules = mockExtractor({});
      const llm = mockExtractor({
        callsignCandidates: [{ value: 'BV2XMT', confidence: 0.7, source: 'llm', createdAt: Date.now() }],
      });

      const hybrid = new HybridFeatureExtractor(rules, llm);
      const features = await hybrid.extract('这里是北京的B维的V 2 小的X马的M天的T');

      expect(llm.calls).toBe(1); // LLM was called
      expect(features.callsignCandidates.some(c => c.value === 'BV2XMT')).toBe(true);
    });

    it('should call LLM when callsign confidence is below threshold', async () => {
      const rules = mockExtractor({
        callsignCandidates: [{ value: 'W1AW', confidence: 0.3, source: 'rule', createdAt: Date.now() }],
      });
      const llm = mockExtractor({
        callsignCandidates: [{ value: 'W1AW', confidence: 0.8, source: 'llm', createdAt: Date.now() }],
      });

      const hybrid = new HybridFeatureExtractor(rules, llm, { confidenceThreshold: 0.5 });
      const features = await hybrid.extract('W1AW maybe');

      expect(llm.calls).toBe(1);
      // Both rule and LLM candidates merged (same value → rule kept, LLM not duplicated)
      expect(features.callsignCandidates.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('merge behavior', () => {
    it('should keep rule candidates and add non-duplicate LLM candidates', async () => {
      const rules = mockExtractor({
        callsignCandidates: [{ value: 'W1AW', confidence: 0.3, source: 'rule', createdAt: Date.now() }],
      });
      const llm = mockExtractor({
        callsignCandidates: [
          { value: 'W1AW', confidence: 0.8, source: 'llm', createdAt: Date.now() },
          { value: 'JA1ABC', confidence: 0.6, source: 'llm', createdAt: Date.now() },
        ],
        nameCandidates: [{ value: 'John', confidence: 0.7, source: 'llm', createdAt: Date.now() }],
      });

      const hybrid = new HybridFeatureExtractor(rules, llm, { confidenceThreshold: 0.5 });
      const features = await hybrid.extract('test');

      // W1AW from rules kept, JA1ABC from LLM added, W1AW not duplicated
      expect(features.callsignCandidates.map(c => c.value)).toEqual(['W1AW', 'JA1ABC']);
      // Name from LLM added
      expect(features.nameCandidates).toHaveLength(1);
      expect(features.nameCandidates[0].value).toBe('John');
    });

    it('should prefer rule signals over LLM signals', async () => {
      const rules = mockExtractor({
        closingSignals: [{ type: 'farewell', matchedText: '73', position: 5, confidence: 0.9 }],
      });
      const llm = mockExtractor({
        closingSignals: [{ type: 'farewell', matchedText: '73', position: 0, confidence: 0.8 }],
        callsignCandidates: [{ value: 'W1AW', confidence: 0.7, source: 'llm', createdAt: Date.now() }],
      });

      const hybrid = new HybridFeatureExtractor(rules, llm);
      const features = await hybrid.extract('no callsign and no signals... wait');
      // Rules had closing signal → closing from rules kept (position=5, not 0)
      expect(features.closingSignals[0].position).toBe(5);
    });

    it('should use LLM signals when rules found none', async () => {
      const rules = mockExtractor({});
      const llm = mockExtractor({
        closingSignals: [{ type: 'farewell', matchedText: '再见', position: 0, confidence: 0.8 }],
      });

      const hybrid = new HybridFeatureExtractor(rules, llm);
      const features = await hybrid.extract('something LLM can parse');
      expect(features.closingSignals).toHaveLength(1);
    });
  });

  describe('LLM failure graceful degradation', () => {
    it('should return rule results when LLM throws', async () => {
      const rules = mockExtractor({
        callsignCandidates: [{ value: 'W1AW', confidence: 0.3, source: 'rule', createdAt: Date.now() }],
      });
      const failingLLM: IFeatureExtractor = {
        extract: async () => { throw new Error('API timeout'); },
      };

      const hybrid = new HybridFeatureExtractor(rules, failingLLM, { confidenceThreshold: 0.5 });
      const features = await hybrid.extract('test');

      // Should return rule results, not throw
      expect(features.callsignCandidates).toHaveLength(1);
      expect(features.callsignCandidates[0].value).toBe('W1AW');
    });
  });
});
