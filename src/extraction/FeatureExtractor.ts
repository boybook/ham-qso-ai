import type { TurnFeatures } from '../types/turn.js';
import { CallsignExtractor } from './CallsignExtractor.js';
import { RSTExtractor } from './RSTExtractor.js';
import { ClosingDetector } from './ClosingDetector.js';

/**
 * Feature extractor interface.
 * All feature extraction implementations must conform to this interface,
 * whether rule-based, LLM-based, or hybrid.
 */
export interface IFeatureExtractor {
  /**
   * Extract features from transcribed text.
   * @param text The transcribed text from ASR
   * @param turnId Optional turn ID for provenance tracking
   * @param context Optional context (e.g., known callsigns, frequency) for better extraction
   */
  extract(text: string, turnId?: string, context?: ExtractionContext): Promise<TurnFeatures> | TurnFeatures;
}

/**
 * Context information that can help extraction.
 */
export interface ExtractionContext {
  /** Known callsigns from previous turns */
  knownCallsigns?: string[];
  /** Operator's own callsign */
  myCallsign?: string;
  /** Current frequency */
  frequency?: number;
  /** Current mode */
  mode?: string;
  /** Language hint */
  language?: string;
}

/**
 * Rule-based feature extractor.
 * Uses regex patterns and deterministic rules for extraction.
 * Fast, free, works offline, but less accurate for edge cases.
 */
export class RuleBasedFeatureExtractor implements IFeatureExtractor {
  private readonly callsignExtractor: CallsignExtractor;
  private readonly rstExtractor: RSTExtractor;
  private readonly closingDetector: ClosingDetector;

  constructor() {
    this.callsignExtractor = new CallsignExtractor();
    this.rstExtractor = new RSTExtractor();
    this.closingDetector = new ClosingDetector();
  }

  extract(text: string, turnId?: string, _context?: ExtractionContext): TurnFeatures {
    return {
      callsignCandidates: this.callsignExtractor.extract(text, turnId),
      rstCandidates: this.rstExtractor.extract(text, turnId),
      nameCandidates: [],
      qthCandidates: [],
      gridCandidates: [],
      closingSignals: this.closingDetector.detectClosing(text),
      continuationSignals: this.closingDetector.detectContinuation(text),
      qsoStartSignals: this.closingDetector.detectStart(text),
    };
  }
}

