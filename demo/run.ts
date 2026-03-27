/**
 * Demo: Process a real radio recording through the full pipeline.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... npx tsx demo/run.ts
 *
 * Requires ffmpeg to be installed (used to decode demo.opus).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

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

import { createPipeline } from '../src/index.js';
import type { QSODraft, ProcessedTurn } from '../src/index.js';

const __dirname = __dirname2;

// ─── Config ──────────────────────────────────────────────────────
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY;
if (!OPENAI_API_KEY && !DASHSCOPE_API_KEY) {
  console.error('Error: OPENAI_API_KEY or DASHSCOPE_API_KEY environment variable is required');
  process.exit(1);
}

const OPUS_PATH = path.join(__dirname, 'demo.opus');
if (!fs.existsSync(OPUS_PATH)) {
  console.error(`Error: ${OPUS_PATH} not found`);
  process.exit(1);
}

// ─── Decode Opus via ffmpeg ───────────────────────────────────────
function decodeOpus(filePath: string): { samples: Float32Array; sampleRate: number } {
  const sampleRate = 16000;
  const result = spawnSync('ffmpeg', [
    '-i', filePath,
    '-f', 'f32le',   // raw 32-bit float PCM
    '-ar', String(sampleRate),
    '-ac', '1',      // mono
    'pipe:1',
  ], { maxBuffer: 256 * 1024 * 1024 });

  if (result.error) throw new Error(`ffmpeg not found: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`ffmpeg failed:\n${result.stderr?.toString()}`);

  const buf = result.stdout as Buffer;
  const samples = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  console.log(`Decoded opus: ${sampleRate}Hz mono, ${(samples.length / sampleRate).toFixed(1)}s`);
  return { samples, sampleRate };
}

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  const { samples, sampleRate } = decodeOpus(OPUS_PATH);

  // Create pipeline with factory function — one line setup
  const useDashScope = !!DASHSCOPE_API_KEY;
  const preset = useDashScope ? 'dashscope' : 'openai';
  const apiKey = useDashScope ? DASHSCOPE_API_KEY! : OPENAI_API_KEY!;

  console.log(`Using preset: ${preset}`);

  const pipeline = createPipeline(preset as 'dashscope' | 'openai', {
    apiKey,
    myCallsign: 'LISTENER',
    languageHint: 'zh',
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

  // stop() flushes VAD and drains the turn processing queue.
  // All enqueued turns will be fully processed before stop() resolves.
  console.log('\nStopping pipeline (draining turn queue)...');
  await pipeline.stop();

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total turns: ${turns.length}`);

  // Print known stations
  const stations = pipeline.stationRegistry.getAll();
  if (stations.length > 0) {
    console.log(`\nKnown stations: ${stations.length}`);
    for (const s of stations) {
      const qth = s.resolveQTH()?.value ?? '?';
      const equip = s.resolveEquipment()?.value;
      console.log(`  ${s.callsign} (conf: ${s.confidence.toFixed(2)}, seen ${s.turnCount}x) QTH: ${qth}${equip ? `, Equipment: ${equip}` : ''}`);
    }
  }

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

  if (draft.stations.length > 0) {
    console.log('  Participants:');
    for (const p of draft.stations) {
      const parts = [`    ${p.callsign} (conf: ${p.confidence.toFixed(2)})`];
      if (p.qth) parts.push(`QTH: ${p.qth}`);
      if (p.name) parts.push(`Name: ${p.name}`);
      if (p.equipment) parts.push(`Equipment: ${p.equipment}`);
      console.log(parts.join(' | '));
    }
  }

  const rstAB = draft.rstAtoB?.value || '?';
  const rstBA = draft.rstBtoA?.value || '?';
  console.log(`  RST A→B: ${rstAB}  RST B→A: ${rstBA}`);
  console.log(`  Frequency: ${f.frequency.value ? (f.frequency.value / 1000000).toFixed(3) + ' MHz' : '?'}  Mode: ${f.mode.value || '?'}`);
  console.log(`  Turns: ${draft.turns.length}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
