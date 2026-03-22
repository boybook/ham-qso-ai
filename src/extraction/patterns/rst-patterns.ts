/**
 * Patterns for detecting RST (Readability-Strength-Tone) signal reports.
 */

/**
 * RST intro phrases that precede signal reports.
 */
export const RST_INTRO_PHRASES = [
  // English
  /\byou(?:'re| are)\b/i,
  /\breport\b/i,
  /\bsignal\b/i,
  /\byour signal\b/i,
  /\bgiving you\b/i,
  /\bcopy(?:ing)?\b/i,
  /\bcoming in\b/i,
  /\bread(?:ing)? you\b/i,
  // Chinese
  /信号/,
  /报告/,
  /给你/,
  /收到/,
  /抄收/,
  /你的信号/,
];

/**
 * Numeric RST patterns: "59", "5 9", "5/9", "579", "5-9"
 */
export const NUMERIC_RST = /\b([1-5])\s*[\/\-]?\s*([1-9])\b/g;

/**
 * Word-based RST patterns: "five nine", "five by nine", "five and nine"
 */
export interface WordRSTMapping {
  pattern: RegExp;
  rst: string;
}

const NUM_WORDS: Record<string, string> = {
  // English
  one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9',
  zero: '0',
  // Chinese
  '零': '0', '一': '1', '二': '2', '三': '3', '四': '4',
  '五': '5', '六': '6', '七': '7', '八': '8', '九': '9',
  '两': '2',
};

// Separate English and Chinese number words for regex building
const EN_NUM_WORDS = Object.keys(NUM_WORDS).filter(k => /^[a-z]+$/i.test(k));
const ZH_NUM_WORDS = Object.keys(NUM_WORDS).filter(k => !/^[a-z]+$/i.test(k));

/**
 * Build regex for English word-form RST like "five nine", "five by nine"
 */
export const WORD_RST_PATTERN = new RegExp(
  `\\b(${EN_NUM_WORDS.join('|')})\\s+(?:by\\s+|and\\s+)?(${EN_NUM_WORDS.join('|')})\\b`,
  'gi',
);

/**
 * Chinese word-form RST like "五九", "五个九"
 * Chinese characters don't have word boundaries, so no \b needed.
 */
export const ZH_WORD_RST_PATTERN = new RegExp(
  `(${ZH_NUM_WORDS.join('|')})[个]?(${ZH_NUM_WORDS.join('|')})`,
  'g',
);

/**
 * Convert a number word to its digit.
 */
export function numberWordToDigit(word: string): string | undefined {
  return NUM_WORDS[word.toLowerCase()];
}

/**
 * Common RST report values and their patterns.
 */
export const COMMON_RST_PHRASES: Array<{ pattern: RegExp; rst: string }> = [
  // English
  { pattern: /\bfive\s*(?:by\s+|and\s+)?nine\b/i, rst: '59' },
  { pattern: /\bfive\s*(?:by\s+|and\s+)?eight\b/i, rst: '58' },
  { pattern: /\bfive\s*(?:by\s+|and\s+)?seven\b/i, rst: '57' },
  { pattern: /\bfour\s*(?:by\s+|and\s+)?nine\b/i, rst: '49' },
  { pattern: /\bthree\s*(?:by\s+|and\s+)?nine\b/i, rst: '39' },
  { pattern: /\bfive\s*(?:by\s+|and\s+)?five\b/i, rst: '55' },
  // Chinese: "五九", "五个九", "五拐", etc.
  { pattern: /五[个]?九/, rst: '59' },
  { pattern: /五[个]?八/, rst: '58' },
  { pattern: /五[个]?七/, rst: '57' },
  { pattern: /五[个]?五/, rst: '55' },
  { pattern: /四[个]?九/, rst: '49' },
  { pattern: /三[个]?九/, rst: '39' },
];
