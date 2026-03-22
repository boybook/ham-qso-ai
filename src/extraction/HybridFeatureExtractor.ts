import type { TurnFeatures, SignalHit } from '../types/turn.js';
import type { FieldCandidate } from '../types/qso.js';
import type { IFeatureExtractor, ExtractionContext } from './FeatureExtractor.js';
import { createLogger, type ILogger } from '../utils/logger.js';

/**
 * Hybrid feature extractor: rules first, LLM fills gaps.
 *
 * Strategy:
 * 1. Run rule-based extraction (fast, free)
 * 2. Evaluate: are key fields missing or low-confidence?
 * 3. If yes → run LLM extraction, merge results
 * 4. If no → return rule results directly (no LLM cost)
 *
 * "Key fields" = callsign + RST. Contextual fields (name/QTH/grid)
 * are only expected from LLM, so their absence alone does NOT trigger LLM.
 */
export class HybridFeatureExtractor implements IFeatureExtractor {
  private readonly ruleExtractor: IFeatureExtractor;
  private readonly llmExtractor: IFeatureExtractor;
  private readonly logger: ILogger;
  private readonly confidenceThreshold: number;

  /**
   * @param ruleExtractor Rule-based extractor (runs first, always)
   * @param llmExtractor LLM-based extractor (runs only when rules are insufficient)
   * @param options.confidenceThreshold Min confidence for a field to be considered "good enough".
   *        If all key fields exceed this threshold, LLM is skipped. Default 0.5.
   */
  constructor(
    ruleExtractor: IFeatureExtractor,
    llmExtractor: IFeatureExtractor,
    options?: { confidenceThreshold?: number; logger?: ILogger },
  ) {
    this.ruleExtractor = ruleExtractor;
    this.llmExtractor = llmExtractor;
    this.confidenceThreshold = options?.confidenceThreshold ?? 0.5;
    this.logger = createLogger('HybridExtractor', options?.logger);
  }

  async extract(text: string, turnId?: string, context?: ExtractionContext): Promise<TurnFeatures> {
    // Step 1: Always run rules first
    const ruleResult = await this.ruleExtractor.extract(text, turnId, context);

    // Step 2: Evaluate rule results — do we need LLM?
    const verdict = this.evaluate(ruleResult);

    if (!verdict.needsLLM) {
      return ruleResult;
    }

    // Step 3: Run LLM to fill the gaps
    this.logger.debug('rule extraction insufficient, invoking LLM', {
      reason: verdict.reason,
    });

    try {
      const llmResult = await this.llmExtractor.extract(text, turnId, context);
      return this.merge(ruleResult, llmResult);
    } catch {
      this.logger.warn('LLM extraction failed, using rule results only');
      return ruleResult;
    }
  }

  /**
   * Evaluate whether rule results are sufficient or LLM is needed.
   *
   * LLM is triggered when ANY of:
   * - No callsign candidates at all
   * - Callsign candidates exist but all below confidence threshold
   * - No RST candidates AND no closing/start/continuation signals
   *   (i.e., the turn appears to have meaningful content but rules found almost nothing)
   */
  private evaluate(features: TurnFeatures): { needsLLM: boolean; reason: string } {
    const bestCallsignConf = Math.max(
      0,
      ...features.callsignCandidates.map(c => c.confidence),
    );

    // Callsign is the MOST IMPORTANT field. Always invoke LLM when missing.
    if (features.callsignCandidates.length === 0) {
      // Only skip LLM for pure signal turns (just "roger"/"73"/"CQ" with nothing else)
      const hasOnlySignals =
        (features.closingSignals.length > 0 ||
         features.continuationSignals.length > 0 ||
         features.qsoStartSignals.length > 0) &&
        features.rstCandidates.length === 0;

      if (hasOnlySignals) {
        return { needsLLM: false, reason: '' };
      }
      return { needsLLM: true, reason: 'no callsign from rules' };
    }

    if (bestCallsignConf < this.confidenceThreshold) {
      return { needsLLM: true, reason: `callsign confidence too low: ${bestCallsignConf}` };
    }

    // Rules extracted a good callsign — skip LLM
    return { needsLLM: false, reason: '' };
  }

  private merge(rule: TurnFeatures, llm: TurnFeatures): TurnFeatures {
    return {
      callsignCandidates: mergeCandidates(rule.callsignCandidates, llm.callsignCandidates),
      rstCandidates: mergeCandidates(rule.rstCandidates, llm.rstCandidates),
      nameCandidates: mergeCandidates(rule.nameCandidates, llm.nameCandidates),
      qthCandidates: mergeCandidates(rule.qthCandidates, llm.qthCandidates),
      gridCandidates: mergeCandidates(rule.gridCandidates, llm.gridCandidates),
      closingSignals: rule.closingSignals.length > 0 ? rule.closingSignals : llm.closingSignals,
      continuationSignals: rule.continuationSignals.length > 0 ? rule.continuationSignals : llm.continuationSignals,
      qsoStartSignals: rule.qsoStartSignals.length > 0 ? rule.qsoStartSignals : llm.qsoStartSignals,
    };
  }
}

/** Keep all rule candidates, add non-duplicate LLM candidates */
function mergeCandidates<T>(rule: FieldCandidate<T>[], llm: FieldCandidate<T>[]): FieldCandidate<T>[] {
  const result = [...rule];
  const ruleValues = new Set(rule.map(c => String(c.value)));
  for (const c of llm) {
    if (!ruleValues.has(String(c.value))) {
      result.push(c);
    }
  }
  return result;
}
