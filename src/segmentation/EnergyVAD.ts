import { v4 as uuidv4 } from 'uuid';
import type { Turn } from '../types/turn.js';
import { calculateRMS, concatFloat32Arrays, msToSamples } from '../utils/audio-utils.js';
import type { IVAD, VADConfig } from './types.js';
import { DEFAULT_VAD_CONFIG } from './types.js';

/**
 * Energy-based Voice Activity Detector.
 *
 * Segments continuous audio into turns by detecting speech/silence
 * transitions based on RMS energy levels.
 *
 * Processing is done in frames (default 20ms) for efficiency.
 */
export class EnergyVAD implements IVAD {
  private readonly config: VADConfig;
  private readonly frameSize: number; // samples per analysis frame
  private readonly frameDuration: number; // ms per frame

  private state: 'silence' | 'speech' = 'silence';
  private currentDirection: 'rx' | 'tx' = 'rx';
  private speechStartTime: number = 0;
  private lastSpeechTime: number = 0;
  private speechBuffers: Float32Array[] = [];
  private currentSampleRate: number = 48000;
  private pendingBuffer: Float32Array = new Float32Array(0);

  private turnCallback: ((turn: Turn) => void) | null = null;

  constructor(config?: Partial<VADConfig>) {
    this.config = { ...DEFAULT_VAD_CONFIG, ...config };
    this.frameDuration = 20; // 20ms frames
    this.frameSize = msToSamples(this.frameDuration, 48000); // recalculated per push
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
    const frameSamples = msToSamples(this.frameDuration, sampleRate);

    // If direction changed mid-speech, emit current turn first
    if (this.state === 'speech' && direction !== this.currentDirection) {
      this.emitTurn();
    }
    this.currentDirection = direction;

    // Prepend any pending samples from last push
    let buffer: Float32Array;
    if (this.pendingBuffer.length > 0) {
      buffer = concatFloat32Arrays([this.pendingBuffer, samples]);
      this.pendingBuffer = new Float32Array(0);
    } else {
      buffer = samples;
    }

    // Process frame by frame
    let offset = 0;
    while (offset + frameSamples <= buffer.length) {
      const frame = buffer.subarray(offset, offset + frameSamples);
      const frameTimestamp = timestamp + (offset / sampleRate) * 1000;
      this.processFrame(frame, frameTimestamp);
      offset += frameSamples;
    }

    // Save remaining samples for next push
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
  }

  private processFrame(frame: Float32Array, timestamp: number): void {
    const energy = calculateRMS(frame);
    const isSpeech = energy >= this.config.energyThreshold;

    if (this.state === 'silence') {
      if (isSpeech) {
        // Transition to speech
        this.state = 'speech';
        this.speechStartTime = timestamp;
        this.lastSpeechTime = timestamp;
        this.speechBuffers = [frame.slice()];
      }
    } else {
      // Currently in speech state
      this.speechBuffers.push(frame.slice());

      if (isSpeech) {
        this.lastSpeechTime = timestamp;
      }

      const silenceDuration = timestamp - this.lastSpeechTime;
      const totalDuration = timestamp - this.speechStartTime;

      // Check if silence timeout exceeded → end turn
      if (silenceDuration >= this.config.silenceTimeout) {
        this.emitTurn();
      }
      // Check if max turn duration exceeded → force end
      else if (totalDuration >= this.config.maxTurnDuration) {
        this.emitTurn();
      }
    }
  }

  private emitTurn(): void {
    if (this.speechBuffers.length === 0) {
      this.state = 'silence';
      return;
    }

    const audio = concatFloat32Arrays(this.speechBuffers);
    const duration = (audio.length / this.currentSampleRate) * 1000;

    // Only emit if meets minimum duration
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

    // Reset to silence
    this.state = 'silence';
    this.speechBuffers = [];
  }
}
