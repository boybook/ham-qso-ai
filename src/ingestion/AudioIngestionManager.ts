import type { AudioChunk, RadioMetadata } from '../types/audio.js';
import type { Turn } from '../types/turn.js';
import type { IVAD } from '../segmentation/types.js';
import { AudioBuffer } from './AudioBuffer.js';

/**
 * Manages audio ingestion: receives audio chunks and metadata,
 * feeds them to the VAD for segmentation into turns.
 */
export class AudioIngestionManager {
  private readonly vad: IVAD;
  private readonly rxBuffer: AudioBuffer;
  private readonly txBuffer: AudioBuffer;
  private lastMetadata: RadioMetadata | null = null;
  private turnCallback: ((turn: Turn) => void) | null = null;

  constructor(vad: IVAD, bufferDurationMs: number = 30000) {
    this.vad = vad;
    this.rxBuffer = new AudioBuffer(bufferDurationMs);
    this.txBuffer = new AudioBuffer(bufferDurationMs);

    // Wire VAD turn output
    this.vad.onTurn(turn => {
      this.turnCallback?.(turn);
    });
  }

  /**
   * Register callback for completed turns.
   */
  onTurn(callback: (turn: Turn) => void): void {
    this.turnCallback = callback;
  }

  /**
   * Push an audio chunk into the ingestion pipeline.
   */
  pushAudio(chunk: AudioChunk): void {
    // Store in appropriate buffer
    if (chunk.direction === 'tx') {
      this.txBuffer.push(chunk.samples, chunk.timestamp);
    } else {
      this.rxBuffer.push(chunk.samples, chunk.timestamp);
    }

    // Feed to VAD for segmentation
    this.vad.push(chunk.samples, chunk.sampleRate, chunk.direction, chunk.timestamp);
  }

  /**
   * Push radio metadata.
   */
  pushMetadata(metadata: RadioMetadata): void {
    this.lastMetadata = metadata;
  }

  /**
   * Get the last known radio metadata.
   */
  getLastMetadata(): RadioMetadata | null {
    return this.lastMetadata;
  }

  /**
   * Flush any pending audio in the VAD.
   */
  flush(): void {
    this.vad.flush();
  }

  /**
   * Reset all state.
   */
  reset(): void {
    this.vad.reset();
    this.rxBuffer.clear();
    this.txBuffer.clear();
    this.lastMetadata = null;
  }
}
