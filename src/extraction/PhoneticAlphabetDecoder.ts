import {
  ALL_PHONETIC,
  NATO_PHONETIC,
  PHONETIC_NUMBERS,
  CALLSIGN_CONTEXT_TRIGGERS,
  CHINESE_PHONETIC_PATTERN,
  CHINESE_LETTER_ASSOCIATIONS,
} from './patterns/phonetic-alphabet.js';
import { isValidCallsign } from '../utils/ham-utils.js';

/**
 * Result of phonetic alphabet decoding.
 */
export interface PhoneticDecodeResult {
  /** Decoded string (e.g., "BV2XMT") */
  decoded: string;
  /** Original matched text span */
  matchedText: string;
  /** Start position in the original text */
  position: number;
  /** Confidence 0-1 */
  confidence: number;
  /** Whether a context trigger was found before the sequence */
  hasContextTrigger: boolean;
  /** Number of phonetic words matched */
  phoneticWordCount: number;
}

/**
 * Decodes phonetic alphabet sequences from transcribed text.
 *
 * Handles:
 * - NATO/ICAO standard: "Bravo Victor Two X-ray Mike Tango" → "BV2XMT"
 * - ITU variants: "Amsterdam Baltimore..." → "AB..."
 * - Colloquial variants: "Baker Victor Two..." → "BV2..."
 * - Mixed numeric: "Bravo Victor 2 X-ray Mike Tango" → "BV2XMT"
 * - ASR misrecognitions: "alfa" → "A"
 * - Context-aware: "my call is Bravo Victor..." triggers decoding
 */
export class PhoneticAlphabetDecoder {
  private readonly phoneticMap: Record<string, string>;

  constructor() {
    this.phoneticMap = ALL_PHONETIC;
  }

  /**
   * Decode all phonetic sequences found in text.
   */
  decode(text: string): PhoneticDecodeResult[] {
    const results: PhoneticDecodeResult[] = [];

    // Strategy 1: Standard phonetic alphabet (NATO/ITU/colloquial)
    const words = this.tokenize(text);
    if (words.length > 0) {
      let i = 0;
      while (i < words.length) {
        const sequence = this.tryDecodeSequence(words, i, text);
        if (sequence && sequence.phoneticWordCount >= 2) {
          results.push(sequence);
          i += sequence.phoneticWordCount;
        } else {
          i++;
        }
      }
    }

    // Strategy 2: Chinese phonetic spelling "北京的B 上海的V ..."
    const chineseResults = this.decodeChinese(text);
    results.push(...chineseResults);

    return results;
  }

  /**
   * Decode a single phonetic word to its character.
   * Returns undefined if the word is not a known phonetic word.
   */
  decodeSingle(word: string): string | undefined {
    return this.phoneticMap[word.toUpperCase().replace(/-/g, '')];
  }

  /**
   * Check if a word is a known phonetic alphabet word.
   */
  isPhoneticWord(word: string): boolean {
    const upper = word.toUpperCase().replace(/-/g, '');
    return upper in this.phoneticMap;
  }

  /**
   * Try to decode a consecutive sequence of phonetic words starting at index.
   */
  private tryDecodeSequence(
    words: TokenizedWord[],
    startIdx: number,
    originalText: string,
  ): PhoneticDecodeResult | null {
    // Check for context trigger before the sequence
    const hasContextTrigger = this.hasContextTriggerBefore(words, startIdx, originalText);

    let decoded = '';
    let phoneticWordCount = 0;
    let endIdx = startIdx;
    let consecutiveMisses = 0;
    const maxConsecutiveMisses = 1; // Allow 1 non-phonetic word gap (e.g., "and", "as in")

    for (let i = startIdx; i < words.length; i++) {
      const word = words[i];
      const upper = word.text.toUpperCase().replace(/-/g, '');

      // Check for bare digit (e.g., "2" in "Bravo Victor 2 X-ray")
      if (/^\d$/.test(word.text)) {
        decoded += word.text;
        phoneticWordCount++;
        endIdx = i;
        consecutiveMisses = 0;
        continue;
      }

      // Check phonetic map
      const char = this.phoneticMap[upper];
      if (char) {
        decoded += char;
        phoneticWordCount++;
        endIdx = i;
        consecutiveMisses = 0;
        continue;
      }

      // Allow small gaps for filler words
      if (this.isFillerWord(upper) && consecutiveMisses < maxConsecutiveMisses) {
        consecutiveMisses++;
        continue;
      }

      // Sequence broken
      break;
    }

    if (phoneticWordCount < 2) return null;

    // Calculate position in original text
    const startPos = words[startIdx].position;
    const endPos = words[endIdx].position + words[endIdx].text.length;
    const matchedText = originalText.substring(startPos, endPos);

    // Calculate confidence
    const confidence = this.calculateConfidence(decoded, phoneticWordCount, hasContextTrigger);

    return {
      decoded,
      matchedText,
      position: startPos,
      confidence,
      hasContextTrigger,
      phoneticWordCount,
    };
  }

  /**
   * Check if there's a context trigger phrase before the given index.
   */
  private hasContextTriggerBefore(
    words: TokenizedWord[],
    startIdx: number,
    originalText: string,
  ): boolean {
    if (startIdx === 0) return false;

    // Look at the text before the start position
    const startPos = words[startIdx].position;
    const textBefore = originalText.substring(Math.max(0, startPos - 50), startPos).toLowerCase();

    return CALLSIGN_CONTEXT_TRIGGERS.some(trigger => textBefore.includes(trigger));
  }

  /**
   * Calculate confidence based on the decoded result.
   */
  private calculateConfidence(
    decoded: string,
    phoneticWordCount: number,
    hasContextTrigger: boolean,
  ): number {
    let confidence = 0.5;

    // More phonetic words = more confident
    if (phoneticWordCount >= 3) confidence += 0.1;
    if (phoneticWordCount >= 5) confidence += 0.1;

    // Valid callsign format = high confidence
    if (isValidCallsign(decoded)) confidence += 0.2;

    // Context trigger present = boost
    if (hasContextTrigger) confidence += 0.1;

    // Uses NATO words (standard) = slight boost over colloquial
    // (This is approximated by the decode itself being valid)

    return Math.min(1, confidence);
  }

  /**
   * Words that can appear between phonetic words without breaking the sequence.
   */
  private isFillerWord(word: string): boolean {
    const fillers = new Set(['AS', 'IN', 'AND', 'FOR', 'THE', 'LIKE']);
    return fillers.has(word);
  }

  /**
   * Decode Chinese phonetic spelling patterns like "北京的B 上海的V 2 小的X".
   * Also handles the pattern without "的": "北京B 上海V"
   */
  private decodeChinese(text: string): PhoneticDecodeResult[] {
    const results: PhoneticDecodeResult[] = [];

    // Match sequences of "X的Y" or confirmed letter patterns
    // Pattern: Chinese association word + optional "的" + letter/digit
    const zhPattern = /(?:([^\s\dA-Za-z]+)[的]([A-Za-z]))/g;
    const matches: Array<{ char: string; position: number; end: number; matchedText: string }> = [];

    let match;
    while ((match = zhPattern.exec(text)) !== null) {
      const association = match[1];
      const letter = match[2].toUpperCase();

      // Validate: the Chinese word should be a known association, or letter matches
      const expectedLetter = CHINESE_LETTER_ASSOCIATIONS[association];
      // Accept if: known association matches, OR letter is explicitly stated (trust the speaker)
      if (expectedLetter === letter || /^[A-Z]$/.test(letter)) {
        matches.push({
          char: letter,
          position: match.index,
          end: match.index + match[0].length,
          matchedText: match[0],
        });
      }
    }

    // Also find bare digits between Chinese phonetic groups
    // e.g., "北京的B 上海的V 2 小的X 马的M 天的T"
    if (matches.length < 2) return results;

    // Try to form consecutive sequences from matches
    let decoded = '';
    let startPos = matches[0].position;
    let endPos = matches[0].end;
    const matchedParts: string[] = [];

    for (let i = 0; i < matches.length; i++) {
      decoded += matches[i].char;
      endPos = matches[i].end;
      matchedParts.push(matches[i].matchedText);

      // Check for digits between this match and the next
      if (i < matches.length - 1) {
        const between = text.substring(matches[i].end, matches[i + 1].position).trim();
        if (/^\d+$/.test(between)) {
          decoded += between;
          matchedParts.push(between);
        }
      }
    }

    if (decoded.length >= 3) {
      const hasContextTrigger = CALLSIGN_CONTEXT_TRIGGERS.some(trigger =>
        text.substring(Math.max(0, startPos - 50), startPos).toLowerCase().includes(trigger)
      );

      const confidence = this.calculateConfidence(decoded, matches.length, hasContextTrigger);

      results.push({
        decoded,
        matchedText: text.substring(startPos, endPos),
        position: startPos,
        confidence,
        hasContextTrigger,
        phoneticWordCount: matches.length,
      });
    }

    return results;
  }

  /**
   * Tokenize text into words with their positions.
   */
  private tokenize(text: string): TokenizedWord[] {
    const words: TokenizedWord[] = [];
    const regex = /\S+/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      words.push({
        text: match[0],
        position: match.index,
      });
    }
    return words;
  }
}

interface TokenizedWord {
  text: string;
  position: number;
}
