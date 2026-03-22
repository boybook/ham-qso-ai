import type { FieldCandidate } from '../types/qso.js';
import {
  NUMERIC_RST,
  COMMON_RST_PHRASES,
  numberWordToDigit,
  WORD_RST_PATTERN,
  ZH_WORD_RST_PATTERN,
  RST_INTRO_PHRASES,
} from './patterns/rst-patterns.js';

/**
 * Extracts RST (Readability-Strength-Tone) signal report candidates from text.
 *
 * Handles:
 * - Numeric: "59", "5 9", "5/9", "5-9"
 * - Word form: "five nine", "five by nine", "five and nine"
 * - Chinese: "五九", "五个九", "信号五九"
 * - Mixed: "5 nine"
 * - Three-digit (CW): "599", "579"
 */
export class RSTExtractor {
  /**
   * Extract RST candidates from text.
   */
  extract(text: string, turnId?: string): FieldCandidate<string>[] {
    const candidates: FieldCandidate<string>[] = [];
    const now = Date.now();
    const seen = new Set<string>();

    // Strategy 1: Common word phrases (highest priority, most specific)
    for (const { pattern, rst } of COMMON_RST_PHRASES) {
      pattern.lastIndex = 0;
      const match = pattern.exec(text);
      if (match && !seen.has(rst)) {
        seen.add(rst);
        const confidence = this.hasRSTIntroNearby(text, match.index) ? 0.85 : 0.7;
        candidates.push({
          value: rst,
          confidence,
          source: 'rule',
          sourceTurnId: turnId,
          createdAt: now,
          evidence: [`Word RST match: "${match[0]}" → ${rst}`],
        });
      }
    }

    // Strategy 2: Generic word-form RST
    WORD_RST_PATTERN.lastIndex = 0;
    let match;
    while ((match = WORD_RST_PATTERN.exec(text)) !== null) {
      const r = numberWordToDigit(match[1]);
      const s = numberWordToDigit(match[2]);
      if (!r || !s) continue;
      const rst = r + s;
      if (seen.has(rst)) continue;
      if (!this.isValidRST(rst)) continue;
      seen.add(rst);

      const confidence = this.hasRSTIntroNearby(text, match.index) ? 0.8 : 0.65;
      candidates.push({
        value: rst,
        confidence,
        source: 'rule',
        sourceTurnId: turnId,
        createdAt: now,
        evidence: [`Word RST match: "${match[0]}" → ${rst}`],
      });
    }

    // Strategy 2b: Chinese word-form RST
    ZH_WORD_RST_PATTERN.lastIndex = 0;
    while ((match = ZH_WORD_RST_PATTERN.exec(text)) !== null) {
      const r = numberWordToDigit(match[1]);
      const s = numberWordToDigit(match[2]);
      if (!r || !s) continue;
      const rst = r + s;
      if (seen.has(rst)) continue;
      if (!this.isValidRST(rst)) continue;
      seen.add(rst);

      const confidence = this.hasRSTIntroNearby(text, match.index) ? 0.8 : 0.7;
      candidates.push({
        value: rst,
        confidence,
        source: 'rule',
        sourceTurnId: turnId,
        createdAt: now,
        evidence: [`Chinese RST match: "${match[0]}" → ${rst}`],
      });
    }

    // Strategy 3: Numeric RST
    NUMERIC_RST.lastIndex = 0;
    while ((match = NUMERIC_RST.exec(text)) !== null) {
      const rst = match[1] + match[2];
      if (seen.has(rst)) continue;
      if (!this.isValidRST(rst)) continue;
      seen.add(rst);

      const confidence = this.hasRSTIntroNearby(text, match.index) ? 0.75 : 0.55;
      candidates.push({
        value: rst,
        confidence,
        source: 'rule',
        sourceTurnId: turnId,
        createdAt: now,
        evidence: [`Numeric RST match: "${match[0]}" → ${rst}`],
      });
    }

    return candidates;
  }

  /**
   * Validate RST format.
   * R: 1-5, S: 1-9, T (optional for CW): 1-9
   */
  private isValidRST(rst: string): boolean {
    if (rst.length < 2 || rst.length > 3) return false;
    const r = parseInt(rst[0], 10);
    const s = parseInt(rst[1], 10);
    if (r < 1 || r > 5) return false;
    if (s < 1 || s > 9) return false;
    if (rst.length === 3) {
      const t = parseInt(rst[2], 10);
      if (t < 1 || t > 9) return false;
    }
    return true;
  }

  /**
   * Check if there's an RST intro phrase near the position.
   */
  private hasRSTIntroNearby(text: string, position: number): boolean {
    const lookback = text.substring(Math.max(0, position - 40), position);
    return RST_INTRO_PHRASES.some(pattern => pattern.test(lookback));
  }
}
