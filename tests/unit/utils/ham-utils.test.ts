import { describe, it, expect } from 'vitest';
import {
  isValidCallsign,
  normalizeCallsign,
  isValidGrid,
  isCallsignFalsePositive,
} from '../../../src/utils/ham-utils.js';

describe('isValidCallsign', () => {
  it('should accept standard callsigns', () => {
    expect(isValidCallsign('W1AW')).toBe(true);
    expect(isValidCallsign('VR2XMT')).toBe(true);
    expect(isValidCallsign('JA1ABC')).toBe(true);
    expect(isValidCallsign('BV2A')).toBe(true);
    expect(isValidCallsign('9A1A')).toBe(true);
    expect(isValidCallsign('HS0ZIA')).toBe(true);
    expect(isValidCallsign('VK3ABC')).toBe(true);
    expect(isValidCallsign('DL1ABC')).toBe(true);
  });

  it('should accept single-letter prefix callsigns', () => {
    expect(isValidCallsign('K1ABC')).toBe(true);
    expect(isValidCallsign('N0AX')).toBe(true);
    expect(isValidCallsign('G3XYZ')).toBe(true);
  });

  it('should accept 3-character prefix callsigns', () => {
    expect(isValidCallsign('VR2XMT')).toBe(true);
    expect(isValidCallsign('VP8ABC')).toBe(true);
  });

  it('should accept portable/mobile suffixes', () => {
    expect(isValidCallsign('W1AW/P')).toBe(true);
    expect(isValidCallsign('JA1ABC/M')).toBe(true);
    expect(isValidCallsign('W1AW/QRP')).toBe(true);
  });

  it('should reject invalid callsigns', () => {
    expect(isValidCallsign('')).toBe(false);
    expect(isValidCallsign('A')).toBe(false);
    expect(isValidCallsign('AB')).toBe(false);
    expect(isValidCallsign('123')).toBe(false);
    expect(isValidCallsign('HELLO')).toBe(false);
    expect(isValidCallsign('ABCDEFGHIJKLMNOP')).toBe(false);
  });

  it('should reject strings without required digit', () => {
    expect(isValidCallsign('ABCDE')).toBe(false);
  });
});

describe('normalizeCallsign', () => {
  it('should uppercase and trim', () => {
    expect(normalizeCallsign('w1aw')).toBe('W1AW');
    expect(normalizeCallsign(' JA1ABC ')).toBe('JA1ABC');
    expect(normalizeCallsign('vr2xmt')).toBe('VR2XMT');
  });
});

describe('isValidGrid', () => {
  it('should accept 4-character grids', () => {
    expect(isValidGrid('FN31')).toBe(true);
    expect(isValidGrid('JO62')).toBe(true);
    expect(isValidGrid('PM84')).toBe(true);
  });

  it('should accept 6-character grids', () => {
    expect(isValidGrid('FN31pr')).toBe(true);
    expect(isValidGrid('JO62qm')).toBe(true);
  });

  it('should accept 8-character grids', () => {
    expect(isValidGrid('FN31pr16')).toBe(true);
  });

  it('should be case insensitive', () => {
    expect(isValidGrid('fn31PR')).toBe(true);
    expect(isValidGrid('FN31PR')).toBe(true);
  });

  it('should reject invalid grids', () => {
    expect(isValidGrid('')).toBe(false);
    expect(isValidGrid('ZZ99')).toBe(false); // letters must be A-R
    expect(isValidGrid('FN3')).toBe(false);   // too short
    expect(isValidGrid('FN31p')).toBe(false); // 5 chars not valid
  });
});

describe('isCallsignFalsePositive', () => {
  it('should detect common false positives', () => {
    expect(isCallsignFalsePositive('COPY')).toBe(true);
    expect(isCallsignFalsePositive('OVER')).toBe(true);
    expect(isCallsignFalsePositive('FIVE')).toBe(true);
    expect(isCallsignFalsePositive('NINE')).toBe(true);
  });

  it('should be case insensitive', () => {
    expect(isCallsignFalsePositive('copy')).toBe(true);
    expect(isCallsignFalsePositive('Copy')).toBe(true);
  });

  it('should not flag real callsigns', () => {
    expect(isCallsignFalsePositive('W1AW')).toBe(false);
    expect(isCallsignFalsePositive('JA1ABC')).toBe(false);
  });
});
