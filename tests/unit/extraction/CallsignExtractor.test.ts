import { describe, it, expect } from 'vitest';
import { CallsignExtractor } from '../../../src/extraction/CallsignExtractor.js';

describe('CallsignExtractor', () => {
  const extractor = new CallsignExtractor();

  describe('direct callsign matching', () => {
    it('should extract literal callsigns from text', () => {
      const candidates = extractor.extract('I heard W1AW on the frequency');
      expect(candidates.some(c => c.value === 'W1AW')).toBe(true);
    });

    it('should extract multiple callsigns', () => {
      const candidates = extractor.extract('W1AW calling JA1ABC');
      const values = candidates.map(c => c.value);
      expect(values).toContain('W1AW');
      expect(values).toContain('JA1ABC');
    });

    it('should extract callsigns with portable suffix', () => {
      const candidates = extractor.extract('this is W1AW/P');
      expect(candidates.some(c => c.value === 'W1AW/P')).toBe(true);
    });

    it('should handle case insensitive input', () => {
      const candidates = extractor.extract('this is w1aw');
      expect(candidates.some(c => c.value === 'W1AW')).toBe(true);
    });

    it('should boost confidence with intro phrase', () => {
      const withIntro = extractor.extract('this is W1AW');
      const withoutIntro = extractor.extract('W1AW was heard');
      const confWithIntro = withIntro.find(c => c.value === 'W1AW')?.confidence ?? 0;
      const confWithout = withoutIntro.find(c => c.value === 'W1AW')?.confidence ?? 0;
      expect(confWithIntro).toBeGreaterThan(confWithout);
    });

    it('should not extract false positives like COPY, OVER', () => {
      const candidates = extractor.extract('roger copy over');
      expect(candidates).toHaveLength(0);
    });

    it('should extract various international callsigns', () => {
      const cases = [
        { text: 'VR2XMT is calling', expected: 'VR2XMT' },
        { text: 'hearing DL1ABC', expected: 'DL1ABC' },
        { text: 'from VK3DEF', expected: 'VK3DEF' },
        { text: '9A1A is strong', expected: '9A1A' },
        { text: 'HS0ZIA calling CQ', expected: 'HS0ZIA' },
      ];

      for (const { text, expected } of cases) {
        const candidates = extractor.extract(text);
        expect(candidates.some(c => c.value === expected), `Failed for ${expected} in "${text}"`).toBe(true);
      }
    });
  });

  describe('phonetic callsign extraction', () => {
    it('should extract callsign spelled with NATO alphabet', () => {
      const candidates = extractor.extract(
        'this is Bravo Victor Two X-ray Mike Tango'
      );
      expect(candidates.some(c => c.value === 'BV2XMT' && c.source === 'rule:phonetic')).toBe(true);
    });

    it('should extract callsign with mixed digits and phonetic', () => {
      const candidates = extractor.extract(
        'my call is Whiskey 1 Alpha Whiskey'
      );
      expect(candidates.some(c => c.value === 'W1AW')).toBe(true);
    });

    it('should extract both direct and phonetic matches', () => {
      const candidates = extractor.extract(
        'W1AW this is Bravo Victor Two X-ray Mike Tango'
      );
      const directW1AW = candidates.find(c => c.value === 'W1AW' && c.source === 'rule');
      const phoneticBV2XMT = candidates.find(c => c.value === 'BV2XMT' && c.source === 'rule:phonetic');
      expect(directW1AW).toBeDefined();
      expect(phoneticBV2XMT).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle empty text', () => {
      expect(extractor.extract('')).toHaveLength(0);
    });

    it('should handle text with no callsigns', () => {
      expect(extractor.extract('the weather is nice today')).toHaveLength(0);
    });

    it('should include turn ID in candidates', () => {
      const candidates = extractor.extract('W1AW is on', 'turn-123');
      expect(candidates[0].sourceTurnId).toBe('turn-123');
    });
  });
});
