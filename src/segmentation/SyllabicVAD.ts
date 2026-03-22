import { v4 as uuidv4 } from 'uuid';
import type { Turn } from '../types/turn.js';
import { concatFloat32Arrays, calculateRMS, msToSamples } from '../utils/audio-utils.js';
import type { IVAD } from './types.js';

/**
 * SyllabicVAD configuration.
 */
export interface SyllabicVADConfig {
  /** Minimum speech duration in ms to form a valid turn (default 500) */
  minSpeechDuration: number;
  /** Silence duration in ms to end a turn (default 1500) */
  silenceTimeout: number;
  /** Maximum turn duration in ms — force-cut even during speech (default 30000) */
  maxTurnDuration: number;
  /** Analysis frame size in ms (default 30) */
  frameDurationMs: number;
  /**
   * Signal-to-noise ratio threshold in dB above the adaptive noise floor.
   * Higher = more strict, fewer false triggers. (default 6)
   */
  snrThresholdDb: number;
  /**
   * Noise floor tracking rate (0-1).
   * Lower = slower adaptation, more stable. (default 0.02)
   */
  noiseFloorAlpha: number;
  /**
   * Syllabic modulation detection window in ms. (default 400)
   */
  syllabicWindowMs: number;
  /**
   * Minimum syllabic modulation depth to confirm speech.
   * Requires energy fluctuation at speech rhythm (3-5Hz). (default 0.08)
   */
  syllabicModulationThreshold: number;
}

export const DEFAULT_SYLLABIC_VAD_CONFIG: SyllabicVADConfig = {
  minSpeechDuration: 500,
  silenceTimeout: 1500,
  maxTurnDuration: 30000,
  frameDurationMs: 30,
  snrThresholdDb: 6,
  noiseFloorAlpha: 0.02,
  syllabicWindowMs: 400,
  syllabicModulationThreshold: 0.08,
};

/**
 * Syllabic Voice Activity Detector for radio audio.
 *
 * Designed to work with real radio audio where AGC raises the noise floor
 * when voice stops. Uses two complementary detection methods:
 *
 * 1. **Adaptive noise floor + SNR threshold**:
 *    Continuously tracks the noise floor level. When frame energy exceeds
 *    noiseFloor + snrThresholdDb, it's a potential speech frame.
 *    The noise floor only updates during detected silence, so AGC-raised
 *    noise during speech doesn't corrupt the reference.
 *
 * 2. **Syllabic modulation detection**:
 *    Human speech has a ~3-5Hz rhythm (syllable rate). Measures the coefficient
 *    of variation of frame energy over a sliding window. High modulation = speech.
 *    Steady noise or tones have low modulation.
 *
 * A frame is classified as speech when EITHER condition is met, providing
 * robustness against edge cases.
 *
 * References:
 * - DB1NV squelch: https://pa3fwm.nl/technotes/tn16e.html
 * - JPL Smart Squelch: https://www.repeater-builder.com/projects/jpl-vox-sq/ssb-squelch.html
 */
export class SyllabicVAD implements IVAD {
  private readonly config: SyllabicVADConfig;

  private state: 'silence' | 'speech' = 'silence';
  private currentDirection: 'rx' | 'tx' = 'rx';
  private speechStartTime: number = 0;
  private lastSpeechTime: number = 0;
  private speechBuffers: Float32Array[] = [];
  private currentSampleRate: number = 48000;
  private pendingBuffer: Float32Array = new Float32Array(0);

  // Adaptive noise floor (RMS level, linear)
  private noiseFloor: number = -1; // -1 = not yet initialized
  // Recent frame energy history for syllabic detection
  private energyHistory: number[] = [];

  private turnCallback: ((turn: Turn) => void) | null = null;

  constructor(config?: Partial<SyllabicVADConfig>) {
    this.config = { ...DEFAULT_SYLLABIC_VAD_CONFIG, ...config };
  }

  onTurn(callback: (turn: Turn) => void): void {
    this.turnCallback = callback;
  }

  push(
    samples: Float32Array,
    sampleRate: number,
    direction: 'rx' | 'tx',
    timestamp: number,
  ): void {
    this.currentSampleRate = sampleRate;
    const frameSamples = msToSamples(this.config.frameDurationMs, sampleRate);

    if (this.state === 'speech' && direction !== this.currentDirection) {
      this.emitTurn();
    }
    this.currentDirection = direction;

    let buffer: Float32Array;
    if (this.pendingBuffer.length > 0) {
      buffer = concatFloat32Arrays([this.pendingBuffer, samples]);
      this.pendingBuffer = new Float32Array(0);
    } else {
      buffer = samples;
    }

    let offset = 0;
    while (offset + frameSamples <= buffer.length) {
      const frame = buffer.subarray(offset, offset + frameSamples);
      const frameTimestamp = timestamp + (offset / sampleRate) * 1000;
      this.processFrame(frame, frameTimestamp);
      offset += frameSamples;
    }

    if (offset < buffer.length) {
      this.pendingBuffer = buffer.slice(offset);
    }
  }

  flush(): void {
    if (this.state === 'speech' && this.speechBuffers.length > 0) {
      this.emitTurn();
    }
    this.pendingBuffer = new Float32Array(0);
  }

  reset(): void {
    this.state = 'silence';
    this.speechBuffers = [];
    this.speechStartTime = 0;
    this.lastSpeechTime = 0;
    this.pendingBuffer = new Float32Array(0);
    this.noiseFloor = -1;
    this.energyHistory = [];
  }

  private processFrame(frame: Float32Array, timestamp: number): void {
    const rms = calculateRMS(frame);
    const isSpeech = this.detectSpeech(rms);

    if (this.state === 'silence') {
      // Update noise floor during silence
      this.updateNoiseFloor(rms);

      if (isSpeech) {
        this.state = 'speech';
        this.speechStartTime = timestamp;
        this.lastSpeechTime = timestamp;
        this.speechBuffers = [frame.slice()];
      }
    } else {
      this.speechBuffers.push(frame.slice());

      if (isSpeech) {
        this.lastSpeechTime = timestamp;
      } else {
        // Don't update noise floor during speech state to avoid
        // AGC-raised noise corrupting the reference
      }

      const silenceDuration = timestamp - this.lastSpeechTime;
      const totalDuration = timestamp - this.speechStartTime;

      if (silenceDuration >= this.config.silenceTimeout) {
        this.emitTurn();
        // Update noise floor with current level (we're back in silence)
        this.updateNoiseFloor(rms);
      } else if (totalDuration >= this.config.maxTurnDuration) {
        this.emitTurn();
      }
    }
  }

  /**
   * Detect speech using adaptive SNR + syllabic modulation.
   */
  private detectSpeech(rms: number): boolean {
    // Track energy history for syllabic detection
    this.energyHistory.push(rms);
    const maxHistoryLen = Math.ceil(this.config.syllabicWindowMs / this.config.frameDurationMs);
    while (this.energyHistory.length > maxHistoryLen) {
      this.energyHistory.shift();
    }

    // Criterion 1: SNR above adaptive noise floor
    const snrPassed = this.checkSNR(rms);

    // Criterion 2: Syllabic modulation (energy fluctuates at speech rate)
    const syllabicPassed = this.checkSyllabicModulation();

    // Speech if: above noise floor AND (has syllabic modulation OR significantly above noise)
    // The "significantly above" fallback handles speech onsets before modulation builds up
    const significantlyAbove = this.noiseFloor > 0 && rms > this.noiseFloor * 3;

    return snrPassed && (syllabicPassed || significantlyAbove);
  }

  /**
   * Check if RMS exceeds adaptive noise floor by configured SNR threshold.
   */
  private checkSNR(rms: number): boolean {
    if (this.noiseFloor <= 0) {
      // Not yet initialized — use a reasonable default
      this.noiseFloor = rms;
      return false;
    }

    // Convert snrThresholdDb to linear ratio
    const snrLinear = Math.pow(10, this.config.snrThresholdDb / 20);
    return rms > this.noiseFloor * snrLinear;
  }

  /**
   * Update adaptive noise floor (only during silence).
   * Uses exponential moving average.
   */
  private updateNoiseFloor(rms: number): void {
    if (this.noiseFloor < 0) {
      this.noiseFloor = rms;
    } else {
      const alpha = this.config.noiseFloorAlpha;
      this.noiseFloor = alpha * rms + (1 - alpha) * this.noiseFloor;
    }
  }

  /**
   * Check for syllabic modulation in the energy history.
   * Returns true if energy fluctuates in a speech-like pattern.
   */
  private checkSyllabicModulation(): boolean {
    if (this.energyHistory.length < 5) return false;

    const values = this.energyHistory;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    if (mean < 1e-6) return false;

    // Coefficient of variation = stddev / mean
    const variance = values.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / values.length;
    const cv = Math.sqrt(variance) / mean;

    return cv >= this.config.syllabicModulationThreshold;
  }

  private emitTurn(): void {
    if (this.speechBuffers.length === 0) {
      this.state = 'silence';
      return;
    }

    const audio = concatFloat32Arrays(this.speechBuffers);
    const duration = (audio.length / this.currentSampleRate) * 1000;

    if (duration >= this.config.minSpeechDuration) {
      const turn: Turn = {
        id: uuidv4(),
        direction: this.currentDirection,
        startTime: this.speechStartTime,
        endTime: this.speechStartTime + duration,
        duration,
        audio,
        sampleRate: this.currentSampleRate,
      };
      this.turnCallback?.(turn);
    }

    this.state = 'silence';
    this.speechBuffers = [];
  }
}
