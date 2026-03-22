import { describe, it, expect, vi } from 'vitest';
import { EnergyVAD } from '../../../src/segmentation/EnergyVAD.js';
import type { Turn } from '../../../src/types/turn.js';

const SAMPLE_RATE = 48000;

/** Generate a sine wave at given amplitude */
function generateTone(durationMs: number, amplitude: number, sampleRate = SAMPLE_RATE): Float32Array {
  const samples = Math.round((durationMs / 1000) * sampleRate);
  const buffer = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    buffer[i] = amplitude * Math.sin(2 * Math.PI * 440 * i / sampleRate);
  }
  return buffer;
}

/** Generate silence */
function generateSilence(durationMs: number, sampleRate = SAMPLE_RATE): Float32Array {
  return new Float32Array(Math.round((durationMs / 1000) * sampleRate));
}

describe('EnergyVAD', () => {
  it('should detect a speech turn surrounded by silence', () => {
    const vad = new EnergyVAD({
      energyThreshold: 0.005,
      minSpeechDuration: 100,
      silenceTimeout: 200,
    });

    const turns: Turn[] = [];
    vad.onTurn(turn => turns.push(turn));

    let t = 0;
    // 500ms silence
    vad.push(generateSilence(500), SAMPLE_RATE, 'rx', t);
    t += 500;
    // 600ms speech
    vad.push(generateTone(600, 0.5), SAMPLE_RATE, 'rx', t);
    t += 600;
    // 500ms silence (exceeds silenceTimeout=200ms → emits turn)
    vad.push(generateSilence(500), SAMPLE_RATE, 'rx', t);

    expect(turns).toHaveLength(1);
    expect(turns[0].direction).toBe('rx');
    expect(turns[0].duration).toBeGreaterThanOrEqual(100);
  });

  it('should not emit turns shorter than minSpeechDuration', () => {
    const vad = new EnergyVAD({
      energyThreshold: 0.005,
      minSpeechDuration: 500,
      silenceTimeout: 200,
    });

    const turns: Turn[] = [];
    vad.onTurn(turn => turns.push(turn));

    let t = 0;
    // Very short burst (50ms) followed by silence
    vad.push(generateTone(50, 0.5), SAMPLE_RATE, 'rx', t);
    t += 50;
    vad.push(generateSilence(500), SAMPLE_RATE, 'rx', t);

    expect(turns).toHaveLength(0);
  });

  it('should handle direction changes by splitting turns', () => {
    const vad = new EnergyVAD({
      energyThreshold: 0.005,
      minSpeechDuration: 100,
      silenceTimeout: 200,
    });

    const turns: Turn[] = [];
    vad.onTurn(turn => turns.push(turn));

    let t = 0;
    // Speech on RX
    vad.push(generateTone(300, 0.5), SAMPLE_RATE, 'rx', t);
    t += 300;
    // Direction change to TX → should emit RX turn
    vad.push(generateTone(300, 0.5), SAMPLE_RATE, 'tx', t);
    t += 300;
    // Silence to end TX turn
    vad.push(generateSilence(500), SAMPLE_RATE, 'tx', t);

    expect(turns).toHaveLength(2);
    expect(turns[0].direction).toBe('rx');
    expect(turns[1].direction).toBe('tx');
  });

  it('should flush pending speech on flush()', () => {
    const vad = new EnergyVAD({
      energyThreshold: 0.005,
      minSpeechDuration: 100,
      silenceTimeout: 2000,
    });

    const turns: Turn[] = [];
    vad.onTurn(turn => turns.push(turn));

    // Speech without trailing silence
    vad.push(generateTone(500, 0.5), SAMPLE_RATE, 'rx', 0);
    expect(turns).toHaveLength(0);

    vad.flush();
    expect(turns).toHaveLength(1);
  });

  it('should force-end turns exceeding maxTurnDuration', () => {
    const vad = new EnergyVAD({
      energyThreshold: 0.005,
      minSpeechDuration: 100,
      silenceTimeout: 500,
      maxTurnDuration: 1000,
    });

    const turns: Turn[] = [];
    vad.onTurn(turn => turns.push(turn));

    // Continuous speech for 1500ms (exceeds maxTurnDuration=1000ms)
    let t = 0;
    for (let i = 0; i < 15; i++) {
      vad.push(generateTone(100, 0.5), SAMPLE_RATE, 'rx', t);
      t += 100;
    }

    expect(turns.length).toBeGreaterThanOrEqual(1);
  });

  it('should reset state properly', () => {
    const vad = new EnergyVAD({
      energyThreshold: 0.005,
      minSpeechDuration: 100,
      silenceTimeout: 200,
    });

    const turns: Turn[] = [];
    vad.onTurn(turn => turns.push(turn));

    // Start speech
    vad.push(generateTone(300, 0.5), SAMPLE_RATE, 'rx', 0);
    vad.reset();

    // After reset, no turn should have been emitted
    expect(turns).toHaveLength(0);

    // New speech should work from scratch
    let t = 0;
    vad.push(generateTone(300, 0.5), SAMPLE_RATE, 'tx', t);
    t += 300;
    vad.push(generateSilence(500), SAMPLE_RATE, 'tx', t);

    expect(turns).toHaveLength(1);
    expect(turns[0].direction).toBe('tx');
  });

  it('should handle multiple consecutive turns', () => {
    const vad = new EnergyVAD({
      energyThreshold: 0.005,
      minSpeechDuration: 100,
      silenceTimeout: 200,
    });

    const turns: Turn[] = [];
    vad.onTurn(turn => turns.push(turn));

    let t = 0;
    // Turn 1
    vad.push(generateTone(300, 0.5), SAMPLE_RATE, 'rx', t);
    t += 300;
    vad.push(generateSilence(500), SAMPLE_RATE, 'rx', t);
    t += 500;
    // Turn 2
    vad.push(generateTone(400, 0.3), SAMPLE_RATE, 'rx', t);
    t += 400;
    vad.push(generateSilence(500), SAMPLE_RATE, 'rx', t);

    expect(turns).toHaveLength(2);
  });

  it('should assign unique IDs to turns', () => {
    const vad = new EnergyVAD({
      energyThreshold: 0.005,
      minSpeechDuration: 100,
      silenceTimeout: 200,
    });

    const turns: Turn[] = [];
    vad.onTurn(turn => turns.push(turn));

    let t = 0;
    vad.push(generateTone(300, 0.5), SAMPLE_RATE, 'rx', t);
    t += 300;
    vad.push(generateSilence(500), SAMPLE_RATE, 'rx', t);
    t += 500;
    vad.push(generateTone(300, 0.5), SAMPLE_RATE, 'rx', t);
    t += 300;
    vad.push(generateSilence(500), SAMPLE_RATE, 'rx', t);

    expect(turns).toHaveLength(2);
    expect(turns[0].id).not.toBe(turns[1].id);
  });
});
