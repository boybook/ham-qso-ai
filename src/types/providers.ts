/**
 * ASR (Automatic Speech Recognition) provider interface.
 */
export interface IASRProvider {
  /** Provider name identifier */
  readonly name: string;
  /** Initialize the provider (validate API key, etc.) */
  initialize(): Promise<void>;
  /** Transcribe audio to text */
  transcribe(audio: Float32Array, sampleRate: number, options?: ASROptions): Promise<ASRResult>;
  /** Release resources */
  dispose(): Promise<void>;
}

/**
 * Options for ASR transcription.
 */
export interface ASROptions {
  /** Language hint (e.g., 'en', 'ja') */
  language?: string;
  /** Prompt/context hint to improve recognition (e.g., known callsigns) */
  prompt?: string;
  /** Hot words to boost (provider-specific support) */
  hotWords?: string[];
}

/**
 * Result from ASR transcription.
 */
export interface ASRResult {
  /** Transcribed text */
  text: string;
  /** Overall confidence 0-1 */
  confidence: number;
  /** Detected language */
  language?: string;
  /** Word-level timestamps (if supported) */
  words?: ASRWord[];
  /** Provider name */
  provider: string;
}

/**
 * A word with timing information from ASR.
 */
export interface ASRWord {
  /** Word text */
  word: string;
  /** Start time in ms (relative to turn start) */
  start: number;
  /** End time in ms */
  end: number;
  /** Word confidence 0-1 */
  confidence: number;
}

/**
 * LLM (Large Language Model) provider interface.
 */
export interface ILLMProvider {
  /** Provider name identifier */
  readonly name: string;
  /** Initialize the provider */
  initialize(): Promise<void>;
  /** Send a completion request */
  complete(prompt: string, options?: LLMOptions): Promise<LLMResult>;
  /** Release resources */
  dispose(): Promise<void>;
}

/**
 * Options for LLM completion.
 */
export interface LLMOptions {
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Temperature (0-2) */
  temperature?: number;
  /** Request JSON output */
  jsonMode?: boolean;
  /** System prompt */
  systemPrompt?: string;
}

/**
 * Result from LLM completion.
 */
export interface LLMResult {
  /** Generated text */
  text: string;
  /** Token usage */
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
  /** Provider name */
  provider: string;
}

// ─── Unified Turn Processor ───────────────────────────────────────

/**
 * Unified turn processor interface.
 *
 * Replaces the serial ASR → FeatureExtractor chain with a single abstraction.
 * Three implementation strategies:
 *
 * 1. **OmniConversationProcessor**: Maintains a persistent multi-turn conversation
 *    with a multimodal LLM (e.g., qwen3-omni-flash). Each audio turn is a new
 *    message; the LLM naturally retains context from all previous turns.
 *
 * 2. **ChainedTurnProcessor**: Wraps existing IASRProvider + IFeatureExtractor.
 *    Backward-compatible with the original two-step pipeline.
 *
 * 3. **LocalTurnProcessor**: Local ASR + rule-based extraction. No network needed.
 *
 * The processor internally manages all context (conversation history, known
 * callsigns, metadata). The pipeline only needs to call processTurn() and
 * push context updates.
 */
export interface ITurnProcessor {
  /** Provider/implementation name */
  readonly name: string;

  /** Initialize resources (API clients, models, etc.) */
  initialize(): Promise<void>;

  /**
   * Process the next audio turn.
   * Context is managed internally — just pass the audio.
   */
  processTurn(
    audio: Float32Array,
    sampleRate: number,
  ): Promise<TurnProcessorResult>;

  /**
   * Push context updates into the processor.
   * Called by the pipeline when metadata changes or new callsigns are discovered.
   */
  updateContext(update: ContextUpdate): void;

  /**
   * Reset conversation/context state.
   * Called when a QSO session ends to start fresh.
   */
  reset(): void;

  /** Release resources */
  dispose(): Promise<void>;
}

/**
 * Result from processing a turn.
 */
export interface TurnProcessorResult {
  /** Transcribed text */
  text: string;
  /** Confidence estimate 0-1 */
  confidence: number;
  /** Extracted features (callsigns, RST, QTH, signals, etc.) */
  features: import('./turn.js').TurnFeatures;
  /** Provider/processor name */
  provider: string;
}

/**
 * Context update pushed to the processor.
 */
export interface ContextUpdate {
  /** Current frequency in Hz */
  frequency?: number;
  /** Current mode (USB/LSB/FM/CW) */
  mode?: string;
  /** Callsigns discovered so far in this session */
  knownCallsigns?: string[];
  /** Operator's own callsign */
  myCallsign?: string;
  /** Language hint */
  language?: string;
}
