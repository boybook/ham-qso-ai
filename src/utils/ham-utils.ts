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
 * Core callsign regex pattern based on ITU Radio Regulations.
 *
 * Prefix forms (per ITU Section III, Article 19):
 *   - Single letter:     [BFGKIMNRW]       (e.g., K1ABC, W2XY)
 *   - Digit + letter:    [0-9][A-Z]          (e.g., 9A1A, 3D2AG)
 *   - Letter + digit:    [A-Z][0-9]          (e.g., E71A)
 *   - Two letters:       [A-Z][A-Z]          (e.g., BH8NE, VK3DEF)
 * Separator: exactly one digit [0-9]
 * Suffix: 1-4 characters, last must be a letter
 *
 * Ref: https://regex101.com/library/gS6qG8
 *      https://en.wikipedia.org/wiki/Amateur_radio_call_signs
 */
export const CALLSIGN_REGEX = /^(?:[BFGKIMNRW]|[0-9][A-Z]|[A-Z][0-9]|[A-Z]{2})[0-9][A-Z]{1,4}$/;

/**
 * Regex for finding callsigns in text (non-anchored).
 */
export const CALLSIGN_IN_TEXT_REGEX = /\b((?:[BFGKIMNRW]|[0-9][A-Z]|[A-Z][0-9]|[A-Z]{2})[0-9][A-Z]{1,4})\b/g;

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
