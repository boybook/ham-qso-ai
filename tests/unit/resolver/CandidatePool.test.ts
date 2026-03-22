import { describe, it, expect } from 'vitest';
import { CandidatePool } from '../../../src/resolver/CandidatePool.js';
import type { FieldCandidate } from '../../../src/types/qso.js';

function makeCandidate(value: string, confidence: number, source = 'rule' as const): FieldCandidate<string> {
  return {
    value,
    confidence,
    source,
    createdAt: Date.now(),
  };
}

describe('CandidatePool', () => {
  it('should resolve to best candidate', () => {
    const pool = new CandidatePool<string>();
    pool.add(makeCandidate('W1AW', 0.7));
    pool.add(makeCandidate('W1AX', 0.5));

    const result = pool.resolve();
    expect(result).not.toBeNull();
    expect(result!.value).toBe('W1AW');
    expect(result!.confidence).toBeGreaterThan(0);
  });

  it('should return null for empty pool', () => {
    const pool = new CandidatePool<string>();
    expect(pool.resolve()).toBeNull();
  });

  it('should boost confidence for repeated mentions', () => {
    const pool = new CandidatePool<string>();
    pool.add(makeCandidate('W1AW', 0.6));

    const singleResult = pool.resolve();
    const singleConf = singleResult!.confidence;

    pool.add(makeCandidate('W1AW', 0.6));
    pool.add(makeCandidate('W1AW', 0.6));

    const multiResult = pool.resolve();
    expect(multiResult!.confidence).toBeGreaterThan(singleConf);
  });

  it('should rank repeated value above single higher-confidence value', () => {
    const pool = new CandidatePool<string>();
    // W1AW mentioned 3 times with moderate confidence
    pool.add(makeCandidate('W1AW', 0.6));
    pool.add(makeCandidate('W1AW', 0.6));
    pool.add(makeCandidate('W1AW', 0.6));
    // JA1ABC mentioned once with high confidence
    pool.add(makeCandidate('JA1ABC', 0.8));

    const result = pool.resolve();
    // W1AW should win due to repeat bonus
    expect(result!.value).toBe('W1AW');
  });

  it('should list all candidates in resolved result', () => {
    const pool = new CandidatePool<string>();
    pool.add(makeCandidate('W1AW', 0.7));
    pool.add(makeCandidate('JA1ABC', 0.5));

    const result = pool.resolve();
    expect(result!.candidates).toHaveLength(2);
  });

  it('should track pool size', () => {
    const pool = new CandidatePool<string>();
    expect(pool.size).toBe(0);
    expect(pool.isEmpty).toBe(true);

    pool.add(makeCandidate('W1AW', 0.7));
    expect(pool.size).toBe(1);
    expect(pool.isEmpty).toBe(false);
  });

  it('should clear properly', () => {
    const pool = new CandidatePool<string>();
    pool.add(makeCandidate('W1AW', 0.7));
    pool.clear();
    expect(pool.isEmpty).toBe(true);
    expect(pool.resolve()).toBeNull();
  });

  it('should prune when exceeding max candidates', () => {
    const pool = new CandidatePool<string>({ maxCandidates: 3 });
    pool.add(makeCandidate('A1A', 0.3));
    pool.add(makeCandidate('B2B', 0.5));
    pool.add(makeCandidate('C3C', 0.7));
    pool.add(makeCandidate('D4D', 0.9));

    // Should have pruned to 3
    expect(pool.size).toBe(3);
    // Lowest confidence should have been removed
    const all = pool.getAll();
    expect(all.some(c => c.value === 'A1A')).toBe(false);
  });

  it('should weight source types differently', () => {
    const pool = new CandidatePool<string>();
    // Rule source (weight 1.0)
    pool.add(makeCandidate('W1AW', 0.6, 'rule'));

    const ruleResult = pool.resolve()!;

    const pool2 = new CandidatePool<string>();
    // Manual source (weight 1.5)
    pool2.add(makeCandidate('W1AW', 0.6, 'manual'));

    const manualResult = pool2.resolve()!;
    expect(manualResult.confidence).toBeGreaterThan(ruleResult.confidence);
  });
});
