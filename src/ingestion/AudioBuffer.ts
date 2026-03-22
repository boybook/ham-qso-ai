import { concatFloat32Arrays } from '../utils/audio-utils.js';

/**
 * A ring buffer for audio samples with timestamp tracking.
 * Stores a sliding window of recent audio data.
 */
export class AudioBuffer {
  private buffers: Array<{ samples: Float32Array; timestamp: number }> = [];
  private totalSamples: number = 0;
  private readonly maxDurationMs: number;
  private readonly sampleRate: number;

  /**
   * @param maxDurationMs Maximum audio duration to keep (default 30s)
   * @param sampleRate Expected sample rate (default 48000)
   */
  constructor(maxDurationMs: number = 30000, sampleRate: number = 48000) {
    this.maxDurationMs = maxDurationMs;
    this.sampleRate = sampleRate;
  }

  /**
   * Push audio samples into the buffer.
   */
  push(samples: Float32Array, timestamp: number): void {
    this.buffers.push({ samples, timestamp });
    this.totalSamples += samples.length;
    this.prune();
  }

  /**
   * Get all buffered audio as a single Float32Array.
   */
  getAll(): Float32Array {
    if (this.buffers.length === 0) return new Float32Array(0);
    return concatFloat32Arrays(this.buffers.map(b => b.samples));
  }

  /**
   * Get audio from a specific time range.
   */
  getRange(startTime: number, endTime: number): Float32Array {
    const chunks: Float32Array[] = [];
    for (const buf of this.buffers) {
      const bufEndTime = buf.timestamp + (buf.samples.length / this.sampleRate) * 1000;
      if (bufEndTime >= startTime && buf.timestamp <= endTime) {
        chunks.push(buf.samples);
      }
    }
    return chunks.length > 0 ? concatFloat32Arrays(chunks) : new Float32Array(0);
  }

  /**
   * Get the earliest timestamp in the buffer.
   */
  getStartTime(): number | null {
    return this.buffers.length > 0 ? this.buffers[0].timestamp : null;
  }

  /**
   * Get total buffered duration in ms.
   */
  getDurationMs(): number {
    return (this.totalSamples / this.sampleRate) * 1000;
  }

  /**
   * Clear the buffer.
   */
  clear(): void {
    this.buffers = [];
    this.totalSamples = 0;
  }

  private prune(): void {
    const maxSamples = Math.round((this.maxDurationMs / 1000) * this.sampleRate);
    while (this.totalSamples > maxSamples && this.buffers.length > 1) {
      const removed = this.buffers.shift()!;
      this.totalSamples -= removed.samples.length;
    }
  }
}
