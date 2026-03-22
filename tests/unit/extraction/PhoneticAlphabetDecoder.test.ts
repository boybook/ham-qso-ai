import { describe, it, expect } from 'vitest';
import { PhoneticAlphabetDecoder } from '../../../src/extraction/PhoneticAlphabetDecoder.js';

describe('PhoneticAlphabetDecoder', () => {
  const decoder = new PhoneticAlphabetDecoder();

  describe('decodeSingle', () => {
    it('should decode NATO phonetic words', () => {
      expect(decoder.decodeSingle('Alpha')).toBe('A');
      expect(decoder.decodeSingle('Bravo')).toBe('B');
      expect(decoder.decodeSingle('Charlie')).toBe('C');
      expect(decoder.decodeSingle('Delta')).toBe('D');
      expect(decoder.decodeSingle('Echo')).toBe('E');
      expect(decoder.decodeSingle('Foxtrot')).toBe('F');
      expect(decoder.decodeSingle('Golf')).toBe('G');
      expect(decoder.decodeSingle('Hotel')).toBe('H');
      expect(decoder.decodeSingle('India')).toBe('I');
      expect(decoder.decodeSingle('Juliet')).toBe('J');
      expect(decoder.decodeSingle('Kilo')).toBe('K');
      expect(decoder.decodeSingle('Lima')).toBe('L');
      expect(decoder.decodeSingle('Mike')).toBe('M');
      expect(decoder.decodeSingle('November')).toBe('N');
      expect(decoder.decodeSingle('Oscar')).toBe('O');
      expect(decoder.decodeSingle('Papa')).toBe('P');
      expect(decoder.decodeSingle('Quebec')).toBe('Q');
      expect(decoder.decodeSingle('Romeo')).toBe('R');
      expect(decoder.decodeSingle('Sierra')).toBe('S');
      expect(decoder.decodeSingle('Tango')).toBe('T');
      expect(decoder.decodeSingle('Uniform')).toBe('U');
      expect(decoder.decodeSingle('Victor')).toBe('V');
      expect(decoder.decodeSingle('Whiskey')).toBe('W');
      expect(decoder.decodeSingle('X-ray')).toBe('X');
      expect(decoder.decodeSingle('Yankee')).toBe('Y');
      expect(decoder.decodeSingle('Zulu')).toBe('Z');
    });

    it('should decode number words', () => {
      expect(decoder.decodeSingle('Zero')).toBe('0');
      expect(decoder.decodeSingle('One')).toBe('1');
      expect(decoder.decodeSingle('Two')).toBe('2');
      expect(decoder.decodeSingle('Three')).toBe('3');
      expect(decoder.decodeSingle('Four')).toBe('4');
      expect(decoder.decodeSingle('Five')).toBe('5');
      expect(decoder.decodeSingle('Six')).toBe('6');
      expect(decoder.decodeSingle('Seven')).toBe('7');
      expect(decoder.decodeSingle('Eight')).toBe('8');
      expect(decoder.decodeSingle('Nine')).toBe('9');
    });

    it('should decode military/aviation number variants', () => {
      expect(decoder.decodeSingle('Niner')).toBe('9');
      expect(decoder.decodeSingle('Tree')).toBe('3');
      expect(decoder.decodeSingle('Fife')).toBe('5');
    });

    it('should decode ASR misrecognition variants', () => {
      expect(decoder.decodeSingle('Alfa')).toBe('A');
      expect(decoder.decodeSingle('Whisky')).toBe('W');
    });

    it('should decode colloquial variants', () => {
      expect(decoder.decodeSingle('Baker')).toBe('B');
      expect(decoder.decodeSingle('David')).toBe('D');
      expect(decoder.decodeSingle('George')).toBe('G');
      expect(decoder.decodeSingle('Nancy')).toBe('N');
      expect(decoder.decodeSingle('Sugar')).toBe('S');
    });

    it('should be case insensitive', () => {
      expect(decoder.decodeSingle('ALPHA')).toBe('A');
      expect(decoder.decodeSingle('alpha')).toBe('A');
      expect(decoder.decodeSingle('Alpha')).toBe('A');
    });

    it('should return undefined for non-phonetic words', () => {
      expect(decoder.decodeSingle('hello')).toBeUndefined();
      expect(decoder.decodeSingle('the')).toBeUndefined();
      expect(decoder.decodeSingle('signal')).toBeUndefined();
    });
  });

  describe('isPhoneticWord', () => {
    it('should identify phonetic words', () => {
      expect(decoder.isPhoneticWord('Alpha')).toBe(true);
      expect(decoder.isPhoneticWord('Niner')).toBe(true);
      expect(decoder.isPhoneticWord('X-ray')).toBe(true);
    });

    it('should reject non-phonetic words', () => {
      expect(decoder.isPhoneticWord('hello')).toBe(false);
      expect(decoder.isPhoneticWord('signal')).toBe(false);
    });
  });

  describe('decode (full sequences)', () => {
    it('should decode NATO callsign: BV2XMT', () => {
      const results = decoder.decode('Bravo Victor Two X-ray Mike Tango');
      expect(results).toHaveLength(1);
      expect(results[0].decoded).toBe('BV2XMT');
      expect(results[0].phoneticWordCount).toBe(6);
    });

    it('should decode NATO callsign: W1AW', () => {
      const results = decoder.decode('Whiskey One Alpha Whiskey');
      expect(results).toHaveLength(1);
      expect(results[0].decoded).toBe('W1AW');
    });

    it('should decode with bare digits mixed in', () => {
      const results = decoder.decode('Bravo Victor 2 X-ray Mike Tango');
      expect(results).toHaveLength(1);
      expect(results[0].decoded).toBe('BV2XMT');
    });

    it('should decode with context trigger', () => {
      const results = decoder.decode('this is Bravo Victor Two X-ray Mike Tango');
      expect(results).toHaveLength(1);
      expect(results[0].decoded).toBe('BV2XMT');
      expect(results[0].hasContextTrigger).toBe(true);
      expect(results[0].confidence).toBeGreaterThan(0.7);
    });

    it('should decode with "my call is" trigger', () => {
      const results = decoder.decode('my call is Juliet Alpha One Alpha Bravo Charlie');
      expect(results).toHaveLength(1);
      expect(results[0].decoded).toBe('JA1ABC');
      expect(results[0].hasContextTrigger).toBe(true);
    });

    it('should decode multiple callsigns in text', () => {
      const results = decoder.decode(
        'Whiskey One Alpha Whiskey calling Juliet Alpha One Alpha Bravo Charlie'
      );
      expect(results).toHaveLength(2);
      expect(results[0].decoded).toBe('W1AW');
      expect(results[1].decoded).toBe('JA1ABC');
    });

    it('should decode colloquial variants', () => {
      const results = decoder.decode('Baker Victor Two X-ray Mike Tango');
      expect(results).toHaveLength(1);
      expect(results[0].decoded).toBe('BV2XMT');
    });

    it('should not decode single phonetic words', () => {
      const results = decoder.decode('I heard Alpha in the signal');
      expect(results).toHaveLength(0);
    });

    it('should not decode non-adjacent phonetic words', () => {
      const results = decoder.decode('Alpha is a letter and Bravo is another');
      // "Alpha is" → "is" is not phonetic, "a" is filler but then "letter" breaks it
      // Should not form a valid sequence
      expect(results.every(r => r.phoneticWordCount < 2 || r.decoded.length < 3)).toBe(true);
    });

    it('should handle callsign with niner variant', () => {
      const results = decoder.decode('Kilo niner Alpha Bravo Charlie');
      expect(results).toHaveLength(1);
      expect(results[0].decoded).toBe('K9ABC');
    });

    it('should handle text with no phonetic words', () => {
      const results = decoder.decode('the signal is very strong today');
      expect(results).toHaveLength(0);
    });

    it('should handle empty text', () => {
      const results = decoder.decode('');
      expect(results).toHaveLength(0);
    });
  });
});
