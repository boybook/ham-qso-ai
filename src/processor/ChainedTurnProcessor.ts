import type { ITurnProcessor, TurnProcessorResult, ContextUpdate, IASRProvider, ASROptions, ASRResult } from '../types/providers.js';
import type { IFeatureExtractor, ExtractionContext } from '../extraction/FeatureExtractor.js';
import { RuleBasedFeatureExtractor } from '../extraction/FeatureExtractor.js';
import { EMPTY_FEATURES } from '../extraction/llm-response-parser.js';
import { createLogger, type ILogger } from '../utils/logger.js';

/**
 * Chained turn processor: ASR → Feature Extractor.
 *
 * Wraps separate IASRProvider + IFeatureExtractor implementations
 * into the unified ITurnProcessor interface. This preserves backward
 * compatibility with all existing ASR/LLM provider combinations.
 *
 * Context management:
 * - Maintains extraction context (known callsigns, metadata)
 * - Delegates sliding-window history to the extractor (e.g., LLMFeatureExtractor)
 * - Builds ASR prompt from current context
 */
/** Minimal interface for ASR — satisfied by both IASRProvider and ASRManager */
interface ASRTranscriber {
  readonly name?: string;
  initialize(): Promise<void>;
  transcribe(audio: Float32Array, sampleRate: number, options?: ASROptions): Promise<ASRResult | null>;
  dispose(): Promise<void>;
}

export class ChainedTurnProcessor implements ITurnProcessor {
  readonly name = 'chained';
  private readonly asr: ASRTranscriber;
  private readonly extractor: IFeatureExtractor;
  private readonly logger: ILogger;
  private readonly language?: string;

  // Internal context state
  private context: ExtractionContext = {};

  constructor(options: {
    asr: ASRTranscriber;
    extractor?: IFeatureExtractor;
    language?: string;
    myCallsign?: string;
    logger?: ILogger;
  }) {
    this.asr = options.asr;
    this.extractor = options.extractor ?? new RuleBasedFeatureExtractor();
    this.language = options.language;
    this.logger = createLogger('ChainedProcessor', options.logger);
    if (options.myCallsign) {
      this.context.myCallsign = options.myCallsign;
    }
  }

  async initialize(): Promise<void> {
    await this.asr.initialize();
    this.logger.info('initialized', { asr: this.asr.name ?? 'asr' });
  }

  async processTurn(audio: Float32Array, sampleRate: number): Promise<TurnProcessorResult> {
    // Step 1: ASR
    const asrPrompt = this.buildASRPrompt();
    const asrResult = await this.asr.transcribe(audio, sampleRate, {
      language: this.language,
      prompt: asrPrompt,
    });

    if (!asrResult?.text.trim()) {
      return { text: '', confidence: 0, features: { ...EMPTY_FEATURES }, provider: this.asr.name ?? 'asr' };
    }

    // Step 2: Feature extraction
    const features = await this.extractor.extract(asrResult.text, undefined, this.context);

    return {
      text: asrResult.text,
      confidence: asrResult.confidence,
      features,
      provider: this.asr.name ?? 'asr',
    };
  }

  updateContext(update: ContextUpdate): void {
    if (update.frequency !== undefined) this.context.frequency = update.frequency;
    if (update.mode !== undefined) this.context.mode = update.mode;
    if (update.myCallsign !== undefined) this.context.myCallsign = update.myCallsign;
    if (update.language !== undefined) this.context.language = update.language;
    if (update.knownCallsigns) {
      const existing = new Set(this.context.knownCallsigns ?? []);
      for (const cs of update.knownCallsigns) existing.add(cs);
      this.context.knownCallsigns = [...existing];
    }
  }

  reset(): void {
    this.context.knownCallsigns = [];
  }

  async dispose(): Promise<void> {
    await this.asr.dispose();
  }

  private buildASRPrompt(): string {
    const parts: string[] = [];
    const myCall = this.context.myCallsign;
    if (myCall && myCall !== 'LISTENER') {
      parts.push(myCall);
    }
    if (this.language === 'zh') {
      parts.push('业余无线电通联，抄收，Over');
    } else {
      parts.push('Amateur radio QSO, copy, over');
    }
    return parts.join(', ');
  }
}
