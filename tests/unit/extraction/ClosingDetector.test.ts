import { describe, it, expect } from 'vitest';
import { ClosingDetector } from '../../../src/extraction/ClosingDetector.js';

describe('ClosingDetector', () => {
  const detector = new ClosingDetector();

  describe('detectClosing', () => {
    it('should detect "73"', () => {
      const hits = detector.detectClosing('73 and good luck');
      expect(hits.some(h => h.type === 'farewell' && h.matchedText === '73')).toBe(true);
    });

    it('should detect "seventy three"', () => {
      const hits = detector.detectClosing('seventy three from here');
      expect(hits.some(h => h.type === 'farewell')).toBe(true);
    });

    it('should detect "seven three"', () => {
      const hits = detector.detectClosing('seven three old man');
      expect(hits.some(h => h.type === 'farewell')).toBe(true);
    });

    it('should detect "good DX"', () => {
      const hits = detector.detectClosing('good DX and 73');
      expect(hits.some(h => h.matchedText.toLowerCase().includes('good dx'))).toBe(true);
    });

    it('should detect "thanks for the QSO"', () => {
      const hits = detector.detectClosing('thanks for the QSO');
      expect(hits.some(h => h.type === 'thanks')).toBe(true);
    });

    it('should detect "over and out"', () => {
      const hits = detector.detectClosing('over and out');
      expect(hits.some(h => h.type === 'farewell')).toBe(true);
    });

    it('should detect "going QRT"', () => {
      const hits = detector.detectClosing('going QRT for the night');
      expect(hits.some(h => h.type === 'closing')).toBe(true);
    });

    it('should return empty for non-closing text', () => {
      const hits = detector.detectClosing('the signal is strong here');
      expect(hits).toHaveLength(0);
    });
  });

  describe('detectContinuation', () => {
    it('should detect "roger"', () => {
      const hits = detector.detectContinuation('roger that');
      expect(hits.some(h => h.type === 'acknowledgment')).toBe(true);
    });

    it('should detect "copy"', () => {
      const hits = detector.detectContinuation('copy copy');
      expect(hits.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect "go ahead"', () => {
      const hits = detector.detectContinuation('go ahead please');
      expect(hits.some(h => h.type === 'invitation')).toBe(true);
    });

    it('should detect "over"', () => {
      const hits = detector.detectContinuation('back to you over');
      expect(hits.some(h => h.type === 'handoff')).toBe(true);
    });
  });

  describe('detectStart', () => {
    it('should detect "CQ CQ"', () => {
      const hits = detector.detectStart('CQ CQ CQ this is W1AW');
      expect(hits.some(h => h.type === 'cq')).toBe(true);
    });

    it('should detect "CQ DE"', () => {
      const hits = detector.detectStart('CQ DE JA1ABC');
      expect(hits.some(h => h.type === 'cq')).toBe(true);
    });

    it('should detect "QRZ"', () => {
      const hits = detector.detectStart('QRZ QRZ');
      expect(hits.some(h => h.type === 'qrz')).toBe(true);
    });
  });

  describe('calculateClosingScore', () => {
    it('should return 0 for non-closing text', () => {
      expect(detector.calculateClosingScore('the signal is strong')).toBe(0);
    });

    it('should return high score for "73"', () => {
      expect(detector.calculateClosingScore('73 and good luck')).toBeGreaterThanOrEqual(0.8);
    });

    it('should return higher score for multiple closing signals', () => {
      const single = detector.calculateClosingScore('73');
      const multiple = detector.calculateClosingScore('73 and good DX thanks for the QSO');
      expect(multiple).toBeGreaterThan(single);
    });
  });
});
