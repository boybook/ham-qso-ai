import type { SignalHit } from '../types/turn.js';
import {
  CLOSING_PATTERNS,
  CONTINUATION_PATTERNS,
  START_PATTERNS,
} from './patterns/closing-patterns.js';

/**
 * Detects QSO closing signals, continuation signals, and start signals in text.
 */
export class ClosingDetector {
  /**
   * Detect closing signals in text (73, good DX, etc.)
   */
  detectClosing(text: string): SignalHit[] {
    return this.detectPatterns(text, CLOSING_PATTERNS.map(p => ({
      pattern: p.pattern,
      type: p.type,
      confidence: p.strength,
    })));
  }

  /**
   * Detect continuation signals in text (roger, copy, go ahead, etc.)
   */
  detectContinuation(text: string): SignalHit[] {
    return this.detectPatterns(text, CONTINUATION_PATTERNS.map(p => ({
      pattern: p.pattern,
      type: p.type,
      confidence: 0.7,
    })));
  }

  /**
   * Detect QSO start signals in text (CQ, QRZ, calling, etc.)
   */
  detectStart(text: string): SignalHit[] {
    return this.detectPatterns(text, START_PATTERNS.map(p => ({
      pattern: p.pattern,
      type: p.type,
      confidence: 0.8,
    })));
  }

  /**
   * Calculate an overall closing score for the text.
   * Returns 0-1 where higher values indicate stronger closing evidence.
   */
  calculateClosingScore(text: string): number {
    const closingHits = this.detectClosing(text);
    if (closingHits.length === 0) return 0;

    // Take the highest confidence closing signal
    const maxStrength = Math.max(...closingHits.map(h => h.confidence));

    // Multiple closing signals boost the score
    const countBoost = Math.min(0.1 * (closingHits.length - 1), 0.2);

    return Math.min(1, maxStrength + countBoost);
  }

  private detectPatterns(
    text: string,
    patterns: Array<{ pattern: RegExp; type: string; confidence: number }>,
  ): SignalHit[] {
    const hits: SignalHit[] = [];

    for (const { pattern, type, confidence } of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        hits.push({
          type,
          matchedText: match[0],
          position: match.index,
          confidence,
        });
      }
    }

    return hits;
  }
}
