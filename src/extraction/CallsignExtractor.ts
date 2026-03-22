import type { FieldCandidate } from '../types/qso.js';
import { isValidCallsign, isCallsignFalsePositive, normalizeCallsign } from '../utils/ham-utils.js';
import { PhoneticAlphabetDecoder } from './PhoneticAlphabetDecoder.js';
import { CALLSIGN_IN_TEXT, CALLSIGN_INTRO_PHRASES } from './patterns/callsign-patterns.js';

/**
 * Extracts callsign candidates from transcribed text.
 *
 * Uses two strategies:
 * 1. Direct regex matching for literal callsigns in text
 * 2. Phonetic alphabet decoding for spelled-out callsigns
 */
export class CallsignExtractor {
  private readonly phoneticDecoder: PhoneticAlphabetDecoder;

  constructor() {
    this.phoneticDecoder = new PhoneticAlphabetDecoder();
  }

  /**
   * Extract callsign candidates from text.
   */
  extract(text: string, turnId?: string): FieldCandidate<string>[] {
    const candidates: FieldCandidate<string>[] = [];
    const now = Date.now();

    // Strategy 1: Direct callsign regex match
    const directMatches = this.extractDirect(text);
    for (const match of directMatches) {
      candidates.push({
        value: match.callsign,
        confidence: match.confidence,
        source: 'rule',
        sourceTurnId: turnId,
        createdAt: now,
        evidence: [`Direct match: "${match.matchedText}"`],
      });
    }

    // Strategy 2: Phonetic alphabet decoding
    const phoneticMatches = this.extractPhonetic(text);
    for (const match of phoneticMatches) {
      candidates.push({
        value: match.callsign,
        confidence: match.confidence,
        source: 'rule:phonetic',
        sourceTurnId: turnId,
        createdAt: now,
        evidence: [`Phonetic decode: "${match.matchedText}" → ${match.callsign}`],
      });
    }

    return candidates;
  }

  /**
   * Extract callsigns that appear literally in the text.
   */
  private extractDirect(text: string): CallsignMatch[] {
    const results: CallsignMatch[] = [];
    const upperText = text.toUpperCase();

    // Reset regex state
    CALLSIGN_IN_TEXT.lastIndex = 0;
    let match;
    while ((match = CALLSIGN_IN_TEXT.exec(upperText)) !== null) {
      const callsign = normalizeCallsign(match[1]);
      const suffix = match[2] || '';
      const fullCallsign = callsign + suffix.toUpperCase();

      if (!isValidCallsign(callsign)) continue;
      if (isCallsignFalsePositive(callsign)) continue;

      let confidence = 0.7;

      // Boost confidence if preceded by intro phrase
      if (this.hasIntroPhraseNearby(text, match.index)) {
        confidence += 0.15;
      }

      // Boost confidence for longer callsigns (less likely to be false positive)
      if (callsign.length >= 5) confidence += 0.05;

      results.push({
        callsign: fullCallsign,
        matchedText: match[0],
        position: match.index,
        confidence: Math.min(1, confidence),
      });
    }

    return results;
  }

  /**
   * Extract callsigns spelled out using phonetic alphabet.
   */
  private extractPhonetic(text: string): CallsignMatch[] {
    const results: CallsignMatch[] = [];
    const decoded = this.phoneticDecoder.decode(text);

    for (const result of decoded) {
      const callsign = normalizeCallsign(result.decoded);
      if (!isValidCallsign(callsign)) continue;
      if (isCallsignFalsePositive(callsign)) continue;

      results.push({
        callsign,
        matchedText: result.matchedText,
        position: result.position,
        confidence: result.confidence,
      });
    }

    return results;
  }

  /**
   * Check if there's a callsign intro phrase near the given position.
   */
  private hasIntroPhraseNearby(text: string, position: number): boolean {
    const lookback = text.substring(Math.max(0, position - 30), position);
    return CALLSIGN_INTRO_PHRASES.some(pattern => pattern.test(lookback));
  }
}

interface CallsignMatch {
  callsign: string;
  matchedText: string;
  position: number;
  confidence: number;
}
