/**
 * Demo: Process a real radio recording through the full pipeline.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... npx tsx demo/run.ts
 *
 * Expects demo/demo.wav in the same directory.
 * (demo.opus is the compressed version in the repo; convert with:
 *  ffmpeg -i demo/demo.opus demo/demo.wav)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env file
const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname2, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const key = trimmed.slice(0, eq);
      const val = trimmed.slice(eq + 1);
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

import {
  QSOPipeline,
  WhisperProvider,
  OpenAICompatibleProvider,
  HybridFeatureExtractor,
  RuleBasedFeatureExtractor,
  LLMFeatureExtractor,
  SyllabicVAD,
} from '../src/index.js';
import type { QSODraft, ProcessedTurn } from '../src/index.js';

const __dirname = __dirname2;

// ─── Config ──────────────────────────────────────────────────────
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('Error: OPENAI_API_KEY environment variable is required');
  process.exit(1);
}

const WAV_PATH = path.join(__dirname, 'demo.wav');
if (!fs.existsSync(WAV_PATH)) {
  console.error(`Error: ${WAV_PATH} not found`);
  process.exit(1);
}

// ─── Read WAV ────────────────────────────────────────────────────
function readWav(filePath: string): { samples: Float32Array; sampleRate: number } {
  const buf = fs.readFileSync(filePath);

  // Parse WAV header
  const riff = buf.toString('ascii', 0, 4);
  if (riff !== 'RIFF') throw new Error('Not a WAV file');

  const channels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);

  // Find data chunk
  let dataOffset = 36;
  while (dataOffset < buf.length - 8) {
    const chunkId = buf.toString('ascii', dataOffset, dataOffset + 4);
    const chunkSize = buf.readUInt32LE(dataOffset + 4);
    if (chunkId === 'data') {
      dataOffset += 8;
      break;
    }
    dataOffset += 8 + chunkSize;
  }

  // Read PCM data
  const bytesPerSample = bitsPerSample / 8;
  const numSamples = Math.floor((buf.length - dataOffset) / bytesPerSample);
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const offset = dataOffset + i * bytesPerSample;
    if (bitsPerSample === 16) {
      samples[i] = buf.readInt16LE(offset) / 32768;
    } else if (bitsPerSample === 32) {
      samples[i] = buf.readFloatLE(offset);
    }
  }

  console.log(`Loaded WAV: ${sampleRate}Hz, ${channels}ch, ${bitsPerSample}bit, ${(numSamples / sampleRate).toFixed(1)}s`);
  return { samples, sampleRate };
}

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  const { samples, sampleRate } = readWav(WAV_PATH);

  // Create providers
  const whisper = new WhisperProvider({
    apiKey: OPENAI_API_KEY!,
    model: 'whisper-1',
  });

  const llm = new OpenAICompatibleProvider({
    apiKey: OPENAI_API_KEY!,
    model: 'gpt-4o-mini',
  });

  // Initialize LLM provider
  await llm.initialize();

  // Create pipeline with hybrid extraction
  const pipeline = new QSOPipeline({
    asr: { primary: whisper },
    llm: { provider: llm },
    session: {
      myCallsign: 'LISTENER', // SWL / monitor mode
      languageHint: 'zh',
    },
    extractor: new HybridFeatureExtractor(
      new RuleBasedFeatureExtractor(),
      new LLMFeatureExtractor(llm),
    ),
    // SyllabicVAD: adaptive noise floor + syllabic modulation detection
    // Handles AGC-raised noise floor in real radio audio
    segmenter: new SyllabicVAD({
      minSpeechDuration: 500,
      silenceTimeout: 2000,
      maxTurnDuration: 30000,
      snrThresholdDb: 4,                // 4dB above noise floor
      noiseFloorAlpha: 0.01,            // Slow noise floor tracking
      syllabicModulationThreshold: 0.1,
    }),
    silenceTimeout: 20000,
    holdTimeout: 60000,
  });

  // Track events
  const turns: ProcessedTurn[] = [];
  let draftCount = 0;

  pipeline.on('turn:transcribed', (turn) => {
    turns.push(turn);
    console.log(`\n[Turn ${turns.length}] ${turn.direction.toUpperCase()} (${(turn.duration / 1000).toFixed(1)}s)`);
    console.log(`  ASR: "${turn.text}"`);
    console.log(`  Confidence: ${turn.asrConfidence.toFixed(2)}`);

    if (turn.features.callsignCandidates.length > 0) {
      console.log(`  Callsigns: ${turn.features.callsignCandidates.map(c => `${c.value}(${c.confidence.toFixed(2)})`).join(', ')}`);
    }
    if (turn.features.rstCandidates.length > 0) {
      console.log(`  RST: ${turn.features.rstCandidates.map(c => `${c.value}(${c.confidence.toFixed(2)})`).join(', ')}`);
    }
    if (turn.features.closingSignals.length > 0) {
      console.log(`  Closing: ${turn.features.closingSignals.map(s => s.matchedText || s.type).join(', ')}`);
    }
    if (turn.features.nameCandidates.length > 0) {
      console.log(`  Names: ${turn.features.nameCandidates.map(c => c.value).join(', ')}`);
    }
    if (turn.features.qthCandidates.length > 0) {
      console.log(`  QTH: ${turn.features.qthCandidates.map(c => c.value).join(', ')}`);
    }
  });

  pipeline.on('qso:draft', (draft) => {
    draftCount++;
    console.log(`\n=== QSO Draft #${draftCount} created ===`);
  });

  pipeline.on('qso:updated', (draft) => {
    printDraft(draft, 'Updated');
  });

  pipeline.on('qso:ready', (draft) => {
    printDraft(draft, 'READY');
  });

  pipeline.on('qso:closed', (draft) => {
    printDraft(draft, 'CLOSED');
  });

  pipeline.on('error', (err) => {
    console.error(`[Error] ${err.message}`);
  });

  // Start pipeline
  console.log('Starting pipeline...\n');
  await pipeline.start();

  // Push metadata (monitor mode)
  pipeline.pushMetadata({
    frequency: 14200000,
    mode: 'USB',
    pttActive: false,
    timestamp: Date.now(),
  });

  // Push audio in chunks (~1 second each)
  const chunkSize = sampleRate; // 1 second per chunk
  const totalChunks = Math.ceil(samples.length / chunkSize);
  console.log(`Pushing ${totalChunks} audio chunks (${(samples.length / sampleRate).toFixed(1)}s total)...\n`);

  const startTimestamp = Date.now();
  for (let i = 0; i < samples.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, samples.length);
    const chunk = samples.slice(i, end);

    // Use audio-time timestamps (not wall-clock) so VAD timing is correct
    const audioTimestamp = startTimestamp + (i / sampleRate) * 1000;

    pipeline.pushAudio({
      samples: chunk,
      sampleRate,
      direction: 'rx',
      timestamp: audioTimestamp,
    });

    // Small delay to let async processing happen
    await new Promise(r => setTimeout(r, 10));
  }

  // Wait for final processing
  console.log('\nWaiting for final processing...');
  await new Promise(r => setTimeout(r, 5000));

  // Flush and stop
  await pipeline.stop();

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total turns: ${turns.length}`);

  const drafts = pipeline.getActiveDrafts();
  if (drafts.length > 0) {
    for (const draft of drafts) {
      printDraft(draft, 'Final');
    }
  } else {
    console.log('No active drafts.');
  }

  await pipeline.dispose();
}

function printDraft(draft: QSODraft, label: string) {
  const f = draft.fields;
  console.log(`\n--- ${label} Draft [${draft.status}] ---`);
  console.log(`  Their Callsign: ${f.theirCallsign.value || '?'} (conf: ${f.theirCallsign.confidence.toFixed(2)})`);
  console.log(`  RST Sent:       ${f.rstSent.value} (conf: ${f.rstSent.confidence.toFixed(2)})`);
  console.log(`  RST Received:   ${f.rstReceived.value} (conf: ${f.rstReceived.confidence.toFixed(2)})`);
  console.log(`  Frequency:      ${f.frequency.value ? (f.frequency.value / 1000000).toFixed(3) + ' MHz' : '?'}`);
  console.log(`  Mode:           ${f.mode.value || '?'}`);
  console.log(`  My Callsign:    ${f.myCallsign.value}`);
  if (f.theirName?.value) console.log(`  Their Name:     ${f.theirName.value}`);
  if (f.theirQTH?.value) console.log(`  Their QTH:      ${f.theirQTH.value}`);
  if (f.theirGrid?.value) console.log(`  Their Grid:     ${f.theirGrid.value}`);
  console.log(`  Turns:          ${draft.turns.length}`);
  console.log(`  Trace entries:  ${draft.trace.length}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
