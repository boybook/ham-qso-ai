/**
 * Validates an amateur radio callsign format.
 *
 * Callsign format: 1-3 alphanumeric prefix + 1 digit + 1-4 letter suffix
 * Examples: W1AW, VR2XMT, JA1ABC, BV2A, 9A1A, HS0ZIA
 * Also supports portable/mobile suffixes: W1AW/P, JA1ABC/M, W1AW/QRP
 */
export function isValidCallsign(callsign: string): boolean {
  if (!callsign || callsign.length < 3 || callsign.length > 15) return false;

  // Strip portable/mobile suffix for validation
  const base = callsign.split('/')[0];
  if (!base || base.length < 3) return false;

  return CALLSIGN_REGEX.test(base);
}

/**
 * Core callsign regex pattern.
 * Prefix: 1-3 alphanumeric characters (at least one letter)
 * Digit: exactly one digit
 * Suffix: 1-4 letters
 */
export const CALLSIGN_REGEX = /^[A-Z0-9]{1,3}[0-9][A-Z]{1,4}$/;

/**
 * Regex for finding callsigns in text (non-anchored).
 * Uses word boundaries to avoid matching within other words.
 */
export const CALLSIGN_IN_TEXT_REGEX = /\b([A-Z0-9]{1,3}[0-9][A-Z]{1,4})\b/g;

/**
 * Normalize a callsign to uppercase, trimmed.
 */
export function normalizeCallsign(callsign: string): string {
  return callsign.trim().toUpperCase();
}

/**
 * Validates a Maidenhead grid locator.
 * 4-character: AA00 (field + square)
 * 6-character: AA00aa (field + square + subsquare)
 * 8-character: AA00aa00 (field + square + subsquare + extended square)
 */
export function isValidGrid(grid: string): boolean {
  if (!grid) return false;
  return GRID_REGEX.test(grid.toUpperCase());
}

/**
 * Maidenhead grid locator regex.
 */
export const GRID_REGEX = /^[A-R]{2}[0-9]{2}([A-X]{2}([0-9]{2})?)?$/;

/**
 * Common words that look like callsigns but aren't.
 * Used to filter false positives from callsign extraction.
 */
export const CALLSIGN_FALSE_POSITIVES = new Set([
  'COPY', 'OVER', 'BACK', 'TEST', 'FINE', 'GOOD',
  'FIVE', 'NINE', 'ZERO', 'LIKE', 'HAVE', 'BEEN',
  'COME', 'GIVE', 'HERE', 'JUST', 'MAKE', 'NAME',
  'NICE', 'SOME', 'SURE', 'TAKE', 'VERY', 'WERE',
  'WILL', 'WITH', 'YOUR',
]);

/**
 * Check if a string that matches callsign format is a known false positive.
 */
export function isCallsignFalsePositive(candidate: string): boolean {
  return CALLSIGN_FALSE_POSITIVES.has(candidate.toUpperCase());
}
