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
