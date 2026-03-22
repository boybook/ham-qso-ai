import { describe, it, expect } from 'vitest';
import { RSTExtractor } from '../../../src/extraction/RSTExtractor.js';

describe('RSTExtractor', () => {
  const extractor = new RSTExtractor();

  describe('numeric RST extraction', () => {
    it('should extract "59"', () => {
      const candidates = extractor.extract("you're 59");
      expect(candidates.some(c => c.value === '59')).toBe(true);
    });

    it('should extract "5 9"', () => {
      const candidates = extractor.extract("you're 5 9 here");
      expect(candidates.some(c => c.value === '59')).toBe(true);
    });

    it('should extract "5/9"', () => {
      const candidates = extractor.extract("signal is 5/9");
      expect(candidates.some(c => c.value === '59')).toBe(true);
    });

    it('should extract "5-9"', () => {
      const candidates = extractor.extract("reading you 5-9");
      expect(candidates.some(c => c.value === '59')).toBe(true);
    });
  });

  describe('word-form RST extraction', () => {
    it('should extract "five nine"', () => {
      const candidates = extractor.extract("you're five nine");
      expect(candidates.some(c => c.value === '59')).toBe(true);
    });

    it('should extract "five by nine"', () => {
      const candidates = extractor.extract("you're five by nine");
      expect(candidates.some(c => c.value === '59')).toBe(true);
    });

    it('should extract "five and nine"', () => {
      const candidates = extractor.extract("you're five and nine here");
      expect(candidates.some(c => c.value === '59')).toBe(true);
    });

    it('should extract other signal reports', () => {
      const cases = [
        { text: 'reading you five seven', expected: '57' },
        { text: 'four nine signal', expected: '49' },
        { text: 'three nine here', expected: '39' },
      ];

      for (const { text, expected } of cases) {
        const candidates = extractor.extract(text);
        expect(candidates.some(c => c.value === expected), `Failed for "${text}"`).toBe(true);
      }
    });
  });

  describe('confidence boosting with intro phrases', () => {
    it('should have higher confidence with RST intro phrase', () => {
      const withIntro = extractor.extract("your signal is five nine");
      const withoutIntro = extractor.extract("five nine today");
      const confWith = withIntro.find(c => c.value === '59')?.confidence ?? 0;
      const confWithout = withoutIntro.find(c => c.value === '59')?.confidence ?? 0;
      expect(confWith).toBeGreaterThan(confWithout);
    });

    it('should boost with "reading you" prefix', () => {
      const candidates = extractor.extract("reading you five nine");
      const conf = candidates.find(c => c.value === '59')?.confidence ?? 0;
      expect(conf).toBeGreaterThanOrEqual(0.7);
    });
  });

  describe('edge cases', () => {
    it('should not extract invalid RST (R > 5)', () => {
      const candidates = extractor.extract("got 69 on the meter");
      expect(candidates.some(c => c.value === '69')).toBe(false);
    });

    it('should handle empty text', () => {
      expect(extractor.extract('')).toHaveLength(0);
    });

    it('should handle text with no RST', () => {
      expect(extractor.extract('the weather is nice')).toHaveLength(0);
    });

    it('should not duplicate results', () => {
      const candidates = extractor.extract("five nine five nine");
      const fiveNines = candidates.filter(c => c.value === '59');
      expect(fiveNines.length).toBe(1); // Deduplicated
    });

    it('should include turn ID', () => {
      const candidates = extractor.extract("five nine", 'turn-1');
      expect(candidates[0].sourceTurnId).toBe('turn-1');
    });
  });
});
