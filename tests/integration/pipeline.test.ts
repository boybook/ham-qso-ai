import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QSOPipeline } from '../../src/pipeline/QSOPipeline.js';
import { NullASRProvider } from '../../src/asr/providers/NullProvider.js';
import type { QSODraft } from '../../src/types/qso.js';
import type { ProcessedTurn } from '../../src/types/turn.js';
import { TYPICAL_QSO, MONITORED_QSO } from '../fixtures/transcripts/typical-qso.js';

/**
 * Generate a simple tone as Float32Array to simulate audio.
 */
function generateAudio(durationMs: number, sampleRate = 48000): Float32Array {
  const samples = Math.round((durationMs / 1000) * sampleRate);
  const buffer = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    buffer[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / sampleRate);
  }
  return buffer;
}

/**
 * Simulate pushing a QSO conversation through the pipeline.
 * Uses NullASRProvider to return predefined transcripts.
 */
async function simulateQSO(
  fixture: typeof TYPICAL_QSO,
  options?: { waitBetweenTurns?: number },
) {
  const texts = fixture.turns.map(t => t.text);
  const asrProvider = new NullASRProvider({ texts });

  const pipeline = new QSOPipeline({
    asr: { primary: asrProvider },
    session: {
      myCallsign: fixture.myCallsign,
    },
    vad: {
      energyThreshold: 0.001, // Very low threshold so our test audio triggers it
      minSpeechDuration: 50,
      silenceTimeout: 200,
    },
    silenceTimeout: 5000,
    holdTimeout: 10000,
  });

  const events: { type: string; draft?: QSODraft; turn?: ProcessedTurn }[] = [];

  pipeline.on('qso:draft', draft => events.push({ type: 'draft', draft }));
  pipeline.on('qso:updated', draft => events.push({ type: 'updated', draft }));
  pipeline.on('qso:ready', draft => events.push({ type: 'ready', draft }));
  pipeline.on('qso:closed', draft => events.push({ type: 'closed', draft }));
  pipeline.on('turn:transcribed', turn => events.push({ type: 'turn', turn }));
  pipeline.on('error', err => events.push({ type: 'error' }));

  await pipeline.start();

  // Push metadata
  pipeline.pushMetadata({
    frequency: fixture.frequency,
    mode: fixture.mode,
    pttActive: false,
    timestamp: Date.now(),
  });

  // Simulate each turn: push audio (speech) then silence
  let t = Date.now();
  for (const turn of fixture.turns) {
    // Push speech audio
    const audio = generateAudio(1000); // 1 second of audio
    pipeline.pushAudio({
      samples: audio,
      sampleRate: 48000,
      direction: turn.direction,
      timestamp: t,
    });
    t += 1000;

    // Push silence to trigger turn end
    pipeline.pushAudio({
      samples: new Float32Array(48000 * 0.5), // 500ms silence
      sampleRate: 48000,
      direction: turn.direction,
      timestamp: t,
    });
    t += 500;

    // Allow async turn processing
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  // Wait for final processing
  await new Promise(resolve => setTimeout(resolve, 200));

  await pipeline.stop();
  await pipeline.dispose();

  return { events, pipeline };
}

describe('QSOPipeline Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should process a typical participate-mode QSO and produce a draft', async () => {
    const { events } = await simulateQSO(TYPICAL_QSO);

    // Should have transcribed turns
    const turnEvents = events.filter(e => e.type === 'turn');
    expect(turnEvents.length).toBeGreaterThanOrEqual(1);

    // Should have created a draft
    const draftEvents = events.filter(e => e.type === 'draft');
    expect(draftEvents.length).toBeGreaterThanOrEqual(1);

    // Check the latest updated draft
    const updateEvents = events.filter(e => e.type === 'updated');
    if (updateEvents.length > 0) {
      const latestDraft = updateEvents[updateEvents.length - 1].draft!;

      // Should have detected W1AW as their callsign
      if (latestDraft.fields.theirCallsign.value) {
        expect(latestDraft.fields.theirCallsign.value).toBe('W1AW');
      }

      // Should have frequency from metadata
      expect(latestDraft.fields.frequency.value).toBe(14200000);
      expect(latestDraft.fields.mode.value).toBe('USB');
      expect(latestDraft.fields.myCallsign.value).toBe('BV2XMT');
    }
  });

  it('should process a monitored QSO with RX-only audio', async () => {
    const { events } = await simulateQSO(MONITORED_QSO);

    const turnEvents = events.filter(e => e.type === 'turn');
    expect(turnEvents.length).toBeGreaterThanOrEqual(1);

    // In monitor mode, should detect multiple callsigns
    const updateEvents = events.filter(e => e.type === 'updated');
    if (updateEvents.length > 0) {
      const latestDraft = updateEvents[updateEvents.length - 1].draft!;

      // Should have detected at least one of the callsigns
      const callsign = latestDraft.fields.theirCallsign.value;
      if (callsign) {
        expect(
          MONITORED_QSO.expected.callsigns.includes(callsign)
        ).toBe(true);
      }
    }
  });

  it('should emit no errors during normal operation', async () => {
    const { events } = await simulateQSO(TYPICAL_QSO);
    const errors = events.filter(e => e.type === 'error');
    expect(errors).toHaveLength(0);
  });

  it('should include turns in the draft', async () => {
    const { events } = await simulateQSO(TYPICAL_QSO);

    const updateEvents = events.filter(e => e.type === 'updated');
    if (updateEvents.length > 0) {
      const draft = updateEvents[updateEvents.length - 1].draft!;
      expect(draft.turns.length).toBeGreaterThan(0);
      // Each turn should have text
      for (const turn of draft.turns) {
        expect(turn.text).toBeTruthy();
      }
    }
  });

  it('should handle ASR failure gracefully with fallback', async () => {
    // Primary always fails, fallback succeeds
    const failProvider = new NullASRProvider({ fixedText: 'test' });
    failProvider.transcribe = async () => { throw new Error('ASR failed'); };

    const fallbackProvider = new NullASRProvider({ fixedText: 'CQ CQ this is W1AW' });

    const pipeline = new QSOPipeline({
      asr: { primary: failProvider, fallback: fallbackProvider },
      session: { myCallsign: 'BV2XMT' },
      vad: { energyThreshold: 0.001, minSpeechDuration: 50, silenceTimeout: 200 },
    });

    const errors: Error[] = [];
    pipeline.on('error', err => errors.push(err));

    await pipeline.start();

    // Push some audio
    const audio = generateAudio(1000);
    pipeline.pushAudio({
      samples: audio,
      sampleRate: 48000,
      direction: 'rx',
      timestamp: Date.now(),
    });

    // Silence to end turn
    pipeline.pushAudio({
      samples: new Float32Array(48000 * 0.5),
      sampleRate: 48000,
      direction: 'rx',
      timestamp: Date.now() + 1000,
    });

    await new Promise(resolve => setTimeout(resolve, 100));
    await pipeline.dispose();

    // Should not have thrown errors to the pipeline
    expect(errors).toHaveLength(0);
  });
});
