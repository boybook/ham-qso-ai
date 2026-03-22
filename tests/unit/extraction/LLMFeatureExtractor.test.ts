import { describe, it, expect, vi } from 'vitest';
import { LLMFeatureExtractor } from '../../../src/extraction/LLMFeatureExtractor.js';
import type { ILLMProvider, LLMResult, LLMOptions } from '../../../src/types/providers.js';

/** Create a mock LLM provider that returns the given text */
function mockLLM(responseText: string): ILLMProvider {
  return {
    name: 'mock',
    initialize: async () => {},
    complete: async () => ({ text: responseText, provider: 'mock' }),
    dispose: async () => {},
  };
}

describe('LLMFeatureExtractor', () => {
  describe('valid JSON response', () => {
    it('should extract callsigns from LLM response', async () => {
      const llm = mockLLM('{"cs":[{"v":"W1AW","c":0.9}]}');
      const extractor = new LLMFeatureExtractor(llm);
      const features = await extractor.extract('this is W1AW');
      expect(features.callsignCandidates).toHaveLength(1);
      expect(features.callsignCandidates[0].value).toBe('W1AW');
      expect(features.callsignCandidates[0].confidence).toBeCloseTo(0.9);
      expect(features.callsignCandidates[0].source).toBe('llm');
    });

    it('should extract RST from LLM response', async () => {
      const llm = mockLLM('{"rst":[{"v":"59","c":0.85}]}');
      const extractor = new LLMFeatureExtractor(llm);
      const features = await extractor.extract('five nine');
      expect(features.rstCandidates).toHaveLength(1);
      expect(features.rstCandidates[0].value).toBe('59');
    });

    it('should extract closing signals', async () => {
      const llm = mockLLM('{"close":true}');
      const extractor = new LLMFeatureExtractor(llm);
      const features = await extractor.extract('73 good DX');
      expect(features.closingSignals).toHaveLength(1);
    });

    it('should extract names and locations', async () => {
      const llm = mockLLM('{"nm":[{"v":"John"}],"loc":[{"v":"Connecticut"}]}');
      const extractor = new LLMFeatureExtractor(llm);
      const features = await extractor.extract('my name is John from Connecticut');
      expect(features.nameCandidates).toHaveLength(1);
      expect(features.nameCandidates[0].value).toBe('John');
      expect(features.qthCandidates).toHaveLength(1);
      expect(features.qthCandidates[0].value).toBe('Connecticut');
    });

    it('should extract grid locators', async () => {
      const llm = mockLLM('{"grid":[{"v":"FN31","c":0.7}]}');
      const extractor = new LLMFeatureExtractor(llm);
      const features = await extractor.extract('grid FN31');
      expect(features.gridCandidates).toHaveLength(1);
      expect(features.gridCandidates[0].value).toBe('FN31');
    });
  });

  describe('JSON auto-correction', () => {
    it('should handle markdown code fences', async () => {
      const llm = mockLLM('```json\n{"cs":[{"v":"W1AW","c":0.9}]}\n```');
      const extractor = new LLMFeatureExtractor(llm);
      const features = await extractor.extract('W1AW');
      expect(features.callsignCandidates).toHaveLength(1);
    });

    it('should handle text before/after JSON', async () => {
      const llm = mockLLM('Here is the result:\n{"cs":[{"v":"W1AW","c":0.9}]}\nDone.');
      const extractor = new LLMFeatureExtractor(llm);
      const features = await extractor.extract('W1AW');
      expect(features.callsignCandidates).toHaveLength(1);
    });

    it('should handle empty response gracefully', async () => {
      const llm = mockLLM('');
      const extractor = new LLMFeatureExtractor(llm);
      const features = await extractor.extract('something');
      expect(features.callsignCandidates).toHaveLength(0);
    });

    it('should handle completely invalid response gracefully', async () => {
      const llm = mockLLM('I cannot help with that request.');
      const extractor = new LLMFeatureExtractor(llm);
      const features = await extractor.extract('something');
      expect(features.callsignCandidates).toHaveLength(0);
    });

    it('should handle null LLM result gracefully', async () => {
      const llm: ILLMProvider = {
        name: 'mock',
        initialize: async () => {},
        complete: async () => null as any,
        dispose: async () => {},
      };
      const extractor = new LLMFeatureExtractor(llm);
      const features = await extractor.extract('test');
      expect(features.callsignCandidates).toHaveLength(0);
    });
  });

  describe('field-level validation', () => {
    it('should reject invalid callsign formats', async () => {
      const llm = mockLLM('{"cs":[{"v":"HELLO","c":0.9},{"v":"W1AW","c":0.8}]}');
      const extractor = new LLMFeatureExtractor(llm);
      const features = await extractor.extract('test');
      // HELLO is not a valid callsign, W1AW is
      expect(features.callsignCandidates).toHaveLength(1);
      expect(features.callsignCandidates[0].value).toBe('W1AW');
    });

    it('should auto-correct callsign trailing punctuation', async () => {
      const llm = mockLLM('{"cs":[{"v":"W1AW.","c":0.8}]}');
      const extractor = new LLMFeatureExtractor(llm);
      const features = await extractor.extract('test');
      expect(features.callsignCandidates[0].value).toBe('W1AW');
    });

    it('should reject RST with invalid range', async () => {
      const llm = mockLLM('{"rst":[{"v":"69","c":0.8},{"v":"59","c":0.7}]}');
      const extractor = new LLMFeatureExtractor(llm);
      const features = await extractor.extract('test');
      // 69 has R=6 which is invalid (max 5). 59 is valid.
      expect(features.rstCandidates).toHaveLength(1);
      expect(features.rstCandidates[0].value).toBe('59');
    });

    it('should auto-correct RST with non-digit chars', async () => {
      const llm = mockLLM('{"rst":[{"v":"5/9","c":0.8}]}');
      const extractor = new LLMFeatureExtractor(llm);
      const features = await extractor.extract('test');
      expect(features.rstCandidates[0].value).toBe('59');
    });

    it('should reject invalid grid locators', async () => {
      const llm = mockLLM('{"grid":[{"v":"ZZ99","c":0.7},{"v":"FN31","c":0.6}]}');
      const extractor = new LLMFeatureExtractor(llm);
      const features = await extractor.extract('test');
      // ZZ99 is invalid, FN31 is valid
      expect(features.gridCandidates).toHaveLength(1);
      expect(features.gridCandidates[0].value).toBe('FN31');
    });

    it('should clamp confidence to 0-1', async () => {
      const llm = mockLLM('{"cs":[{"v":"W1AW","c":1.5}]}');
      const extractor = new LLMFeatureExtractor(llm);
      const features = await extractor.extract('test');
      expect(features.callsignCandidates[0].confidence).toBe(1);
    });

    it('should handle missing confidence (default to 0.7)', async () => {
      const llm = mockLLM('{"cs":[{"v":"W1AW"}]}');
      const extractor = new LLMFeatureExtractor(llm);
      const features = await extractor.extract('test');
      expect(features.callsignCandidates[0].confidence).toBe(0.7);
    });

    it('should reject absurdly long name strings', async () => {
      const longName = 'A'.repeat(200);
      const llm = mockLLM(`{"nm":[{"v":"${longName}"},{"v":"John"}]}`);
      const extractor = new LLMFeatureExtractor(llm);
      const features = await extractor.extract('test');
      expect(features.nameCandidates).toHaveLength(1);
      expect(features.nameCandidates[0].value).toBe('John');
    });
  });

  describe('LLM provider failure', () => {
    it('should return empty features when LLM throws', async () => {
      const llm: ILLMProvider = {
        name: 'failing',
        initialize: async () => {},
        complete: async () => { throw new Error('API rate limit'); },
        dispose: async () => {},
      };
      const extractor = new LLMFeatureExtractor(llm);
      const features = await extractor.extract('test');
      expect(features.callsignCandidates).toHaveLength(0);
      expect(features.rstCandidates).toHaveLength(0);
    });
  });

  describe('empty input', () => {
    it('should return empty features for empty text', async () => {
      const llm = mockLLM('{}');
      const extractor = new LLMFeatureExtractor(llm);
      const features = await extractor.extract('');
      expect(features.callsignCandidates).toHaveLength(0);
    });

    it('should return empty features for whitespace-only text', async () => {
      const llm = mockLLM('{}');
      const extractor = new LLMFeatureExtractor(llm);
      const features = await extractor.extract('   ');
      expect(features.callsignCandidates).toHaveLength(0);
    });
  });
});
