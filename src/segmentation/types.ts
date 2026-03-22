import type { Turn } from '../types/turn.js';

/**
 * VAD (Voice Activity Detection) interface.
 * Implementations segment continuous audio into turns.
 */
export interface IVAD {
  /**
   * Push audio samples into the VAD.
   * May emit completed turns via the callback.
   */
  push(
    samples: Float32Array,
    sampleRate: number,
    direction: 'rx' | 'tx',
    timestamp: number,
  ): void;

  /**
   * Force flush any buffered audio as a turn.
   */
  flush(): void;

  /**
   * Register a callback for completed turns.
   */
  onTurn(callback: (turn: Turn) => void): void;

  /**
   * Reset VAD state.
   */
  reset(): void;
}

/**
 * VAD configuration.
 */
export interface VADConfig {
  /** RMS energy threshold for speech detection (0-1, default 0.01) */
  energyThreshold: number;
  /** Minimum speech duration in ms to form a valid turn (default 500) */
  minSpeechDuration: number;
  /** Silence duration in ms to end a turn (default 1500) */
  silenceTimeout: number;
  /** Maximum turn duration in ms (default 60000 = 1 minute) */
  maxTurnDuration: number;
}

export const DEFAULT_VAD_CONFIG: VADConfig = {
  energyThreshold: 0.01,
  minSpeechDuration: 500,
  silenceTimeout: 1500,
  maxTurnDuration: 60000,
};
