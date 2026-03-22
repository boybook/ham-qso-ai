/**
 * Patterns for detecting callsigns in text.
 */

/**
 * Standard callsign regex for finding callsigns in text.
 * Matches at word boundaries.
 * Format: 1-3 alphanumeric prefix + 1 digit + 1-4 letter suffix
 * Optionally followed by /P, /M, /QRP, etc.
 */
export const CALLSIGN_IN_TEXT = /\b([A-Z0-9]{1,3}[0-9][A-Z]{1,4})(\/[A-Z0-9]+)?\b/gi;

/**
 * Phrases that introduce a callsign.
 * The callsign typically follows these phrases.
 */
export const CALLSIGN_INTRO_PHRASES = [
  // English
  /\bthis is\b/i,
  /\bmy call(?:sign)? is\b/i,
  /\bstation\b/i,
  /\bcq\s+cq\b/i,
  /\bcq\s+de\b/i,
  /\bcalling\b/i,
  /\bde\b/i,
  /\bfrom\b/i,
  /\bi am\b/i,
  /\bi'm\b/i,
  // Chinese
  /这里是/,
  /我的呼号/,
  /我是/,
  /本台/,
  /呼号是/,
  /呼叫/,
];

/**
 * Phrases that indicate the other station's callsign.
 * The callsign typically precedes these phrases.
 */
export const CALLSIGN_ADDRESSED_PHRASES = [
  /\byou(?:'re| are)\b/i,
  /\bcalling you\b/i,
];
