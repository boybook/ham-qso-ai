/**
 * A chunk of PCM audio data with metadata.
 */
export interface AudioChunk {
  /** PCM samples normalized to [-1, 1] */
  samples: Float32Array;
  /** Sample rate in Hz */
  sampleRate: number;
  /**
   * Audio direction:
   * - 'tx': Transmit audio (speaker identity = myCallsign, known)
   * - 'rx': Receive audio (speaker identity must be inferred from content)
   *
   * TX is essentially audio with a known speaker label.
   * In RX-only / SWL mode, all audio is 'rx' and speaker identity
   * is inferred entirely from ASR + feature extraction.
   */
  direction: 'rx' | 'tx';
  /** Timestamp in milliseconds (Date.now()) */
  timestamp: number;
}

/**
 * Radio metadata that accompanies audio or is pushed independently.
 */
export interface RadioMetadata {
  /** Current frequency in Hz */
  frequency: number;
  /** Operating mode (e.g., 'USB', 'LSB', 'FM', 'AM') */
  mode: string;
  /** PTT state. Always false in monitor/SWL mode. */
  pttActive: boolean;
  /** Timestamp in milliseconds */
  timestamp: number;
}

/**
 * Session-level metadata provided at pipeline startup.
 */
export interface SessionMetadata {
  /** Operator's own callsign */
  myCallsign: string;
  /** Operator's Maidenhead grid locator */
  myGrid?: string;
  /** Language hint for ASR (e.g., 'en', 'ja', 'zh') */
  languageHint?: string;
}
