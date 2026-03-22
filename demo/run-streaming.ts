/**
 * Demo: Simulate real-time streaming input.
 *
 * Pushes audio at real-time speed (1s audio per 1s wall-clock)
 * to verify progressive QSO recognition — fields should appear
 * and grow in confidence as the contact unfolds.
 *
 * Usage:
 *   npx tsx demo/run-streaming.ts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env file
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');
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
  Qwen3ASRProvider,
  OpenAICompatibleProvider,
  HybridFeatureExtractor,
  RuleBasedFeatureExtractor,
  LLMFeatureExtractor,
  SyllabicVAD,
} from '../src/index.js';
import type { QSODraft, ProcessedTurn } from '../src/index.js';

// ─── Config ──────────────────────────────────────────────────────
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY;
if (!OPENAI_API_KEY && !DASHSCOPE_API_KEY) {
  console.error('Error: OPENAI_API_KEY or DASHSCOPE_API_KEY environment variable is required');
  process.exit(1);
}

const WAV_PATH = path.join(__dirname, 'demo.wav');
if (!fs.existsSync(WAV_PATH)) {
  console.error(`Error: ${WAV_PATH} not found`);
  process.exit(1);
}

// ─── Formatting helpers ─────────────────────────────────────────
const GRAY = '\x1b[90m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

let streamStartTime = 0;
function elapsed(): string {
  const s = ((Date.now() - streamStartTime) / 1000).toFixed(1);
  return `${GRAY}[${s.padStart(6)}s]${RESET}`;
}

function audioTime(sampleOffset: number, sampleRate: number): string {
  const s = (sampleOffset / sampleRate).toFixed(1);
  return `${s}s`;
}

function confBar(conf: number): string {
  const filled = Math.round(conf * 10);
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  const color = conf >= 0.8 ? GREEN : conf >= 0.5 ? YELLOW : GRAY;
  return `${color}${bar}${RESET} ${(conf * 100).toFixed(0)}%`;
}

function printDraftCompact(draft: QSODraft, label: string) {
  const f = draft.fields;
  console.log(`${elapsed()} ${BOLD}${CYAN}── ${label} ──${RESET}`);
  if (f.stationCallsigns && f.stationCallsigns.length > 1) {
    console.log(`${elapsed()}   Stations: ${BOLD}${f.stationCallsigns.map(c => c.value).join(' ↔ ')}${RESET}`);
  }
  console.log(`${elapsed()}   Callsign: ${BOLD}${f.theirCallsign.value || '?'}${RESET}  ${confBar(f.theirCallsign.confidence)}`);
  console.log(`${elapsed()}   RST Sent: ${f.rstSent.value || '?'}  ${confBar(f.rstSent.confidence)}  RST Rcvd: ${f.rstReceived.value || '?'}  ${confBar(f.rstReceived.confidence)}`);
  if (f.theirQTH?.value) {
    console.log(`${elapsed()}   QTH:      ${f.theirQTH.value}`);
  }
  console.log(`${elapsed()}   Freq: ${f.frequency.value ? (f.frequency.value / 1_000_000).toFixed(3) + ' MHz' : '?'} ${f.mode.value || ''}  |  Turns: ${draft.turns.length}  |  Status: ${draft.status}`);
}

// ─── Read WAV ────────────────────────────────────────────────────
function readWav(filePath: string): { samples: Float32Array; sampleRate: number } {
  const buf = fs.readFileSync(filePath);
  const riff = buf.toString('ascii', 0, 4);
  if (riff !== 'RIFF') throw new Error('Not a WAV file');
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);
  let dataOffset = 36;
  while (dataOffset < buf.length - 8) {
    const chunkId = buf.toString('ascii', dataOffset, dataOffset + 4);
    const chunkSize = buf.readUInt32LE(dataOffset + 4);
    if (chunkId === 'data') { dataOffset += 8; break; }
    dataOffset += 8 + chunkSize;
  }
  const bytesPerSample = bitsPerSample / 8;
  const numSamples = Math.floor((buf.length - dataOffset) / bytesPerSample);
  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const offset = dataOffset + i * bytesPerSample;
    if (bitsPerSample === 16) samples[i] = buf.readInt16LE(offset) / 32768;
    else if (bitsPerSample === 32) samples[i] = buf.readFloatLE(offset);
  }
  return { samples, sampleRate };
}

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  const { samples, sampleRate } = readWav(WAV_PATH);
  const totalDuration = samples.length / sampleRate;

  // Select providers
  const useDashScope = !!DASHSCOPE_API_KEY;
  const asr = useDashScope
    ? new Qwen3ASRProvider({ apiKey: DASHSCOPE_API_KEY!, model: 'qwen3-asr-flash' })
    : new WhisperProvider({ apiKey: OPENAI_API_KEY!, model: 'whisper-1' });
  const llm = new OpenAICompatibleProvider({
    apiKey: useDashScope ? DASHSCOPE_API_KEY! : OPENAI_API_KEY!,
    model: useDashScope ? 'qwen-plus' : 'gpt-4o',
    baseURL: useDashScope ? 'https://dashscope.aliyuncs.com/compatible-mode/v1' : undefined,
  });
  await llm.initialize();

  // Create pipeline
  const pipeline = new QSOPipeline({
    asr: { primary: asr },
    llm: { provider: llm },
    session: { myCallsign: 'LISTENER', languageHint: 'zh' },
    extractor: new HybridFeatureExtractor(
      new RuleBasedFeatureExtractor(),
      new LLMFeatureExtractor(llm, { maxHistoryTurns: 8 }),
    ),
    segmenter: new SyllabicVAD({
      minSpeechDuration: 500,
      silenceTimeout: 2000,
      maxTurnDuration: 30000,
      snrThresholdDb: 4,
      noiseFloorAlpha: 0.01,
      syllabicModulationThreshold: 0.1,
    }),
    silenceTimeout: 20000,
    holdTimeout: 60000,
  });

  // Track events — concise real-time output
  let turnCount = 0;

  pipeline.on('turn:transcribed', (turn) => {
    turnCount++;
    const fields: string[] = [];
    if (turn.features.callsignCandidates.length > 0)
      fields.push(`CS:${turn.features.callsignCandidates.map(c => c.value).join('/')}`);
    if (turn.features.rstCandidates.length > 0)
      fields.push(`RST:${turn.features.rstCandidates[0].value}`);
    if (turn.features.qthCandidates.length > 0)
      fields.push(`QTH:${turn.features.qthCandidates[0].value}`);
    if (turn.features.closingSignals.length > 0)
      fields.push(`CLOSE`);

    const excerpt = turn.text.length > 60 ? turn.text.substring(0, 60) + '...' : turn.text;
    const fieldStr = fields.length > 0 ? `  ${GREEN}${fields.join(' | ')}${RESET}` : '';
    console.log(`${elapsed()} ${GRAY}Turn ${String(turnCount).padStart(2)}${RESET} (${(turn.duration / 1000).toFixed(1)}s) "${excerpt}"${fieldStr}`);
  });

  pipeline.on('qso:draft', () => {
    console.log(`\n${elapsed()} ${BOLD}${GREEN}>>> QSO Draft created${RESET}`);
  });

  pipeline.on('qso:updated', (draft) => {
    printDraftCompact(draft, 'Draft updated');
  });

  pipeline.on('qso:ready', (draft) => {
    console.log(`\n${elapsed()} ${BOLD}${GREEN}>>> Draft upgraded to READY${RESET}`);
    printDraftCompact(draft, 'READY');
  });

  pipeline.on('qso:closed', (draft) => {
    printDraftCompact(draft, 'CLOSED');
  });

  // Start
  console.log(`${BOLD}Streaming ${totalDuration.toFixed(0)}s of radio audio in real time...${RESET}`);
  console.log(`Provider: ${useDashScope ? 'DashScope (Qwen)' : 'OpenAI'}\n`);

  await pipeline.start();
  pipeline.pushMetadata({
    frequency: 14200000,
    mode: 'USB',
    pttActive: false,
    timestamp: Date.now(),
  });

  // ─── Real-time streaming loop ──────────────────────────────────
  // Push 250ms chunks at real-time speed
  const chunkDurationMs = 250;
  const chunkSamples = Math.round(sampleRate * chunkDurationMs / 1000);

  streamStartTime = Date.now();
  const audioStartTimestamp = streamStartTime;
  let sampleOffset = 0;
  let lastProgressPrint = 0;

  while (sampleOffset < samples.length) {
    const end = Math.min(sampleOffset + chunkSamples, samples.length);
    const chunk = samples.slice(sampleOffset, end);

    const audioTimestamp = audioStartTimestamp + (sampleOffset / sampleRate) * 1000;

    pipeline.pushAudio({
      samples: chunk,
      sampleRate,
      direction: 'rx',
      timestamp: audioTimestamp,
    });

    sampleOffset = end;

    // Print progress every 30 seconds of audio
    const audioSec = sampleOffset / sampleRate;
    if (Math.floor(audioSec / 30) > lastProgressPrint) {
      lastProgressPrint = Math.floor(audioSec / 30);
      const pct = ((audioSec / totalDuration) * 100).toFixed(0);
      console.log(`${elapsed()} ${GRAY}── audio: ${audioSec.toFixed(0)}s / ${totalDuration.toFixed(0)}s (${pct}%) ──${RESET}`);
    }

    // Sleep to maintain real-time pace
    const expectedWallTime = (sampleOffset / sampleRate) * 1000;
    const actualWallTime = Date.now() - streamStartTime;
    const sleepMs = expectedWallTime - actualWallTime;
    if (sleepMs > 0) {
      await new Promise(r => setTimeout(r, sleepMs));
    }
  }

  console.log(`\n${elapsed()} ${GRAY}── Audio stream ended. Waiting for final processing... ──${RESET}`);
  await new Promise(r => setTimeout(r, 8000));

  await pipeline.stop();

  // Final summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`${BOLD} FINAL RESULT${RESET}`);
  console.log(`${'═'.repeat(60)}`);
  console.log(` Turns processed: ${turnCount}`);
  console.log(` Total audio:     ${totalDuration.toFixed(1)}s`);
  console.log(` Wall-clock time: ${((Date.now() - streamStartTime) / 1000).toFixed(1)}s`);

  const drafts = pipeline.getActiveDrafts();
  if (drafts.length > 0) {
    for (const draft of drafts) {
      const f = draft.fields;
      console.log(`\n ${BOLD}QSO Log Entry:${RESET}`);
      console.log(` ┌────────────────────────────────────────┐`);
      console.log(` │ Callsign:  ${(f.theirCallsign.value || '?').padEnd(28)}│`);
      console.log(` │ RST Sent:  ${(f.rstSent.value || '?').padEnd(28)}│`);
      console.log(` │ RST Rcvd:  ${(f.rstReceived.value || '?').padEnd(28)}│`);
      console.log(` │ Freq:      ${f.frequency.value ? (f.frequency.value / 1_000_000).toFixed(3) + ' MHz' : '?'.padEnd(28)}${' '.repeat(Math.max(0, 28 - (f.frequency.value ? 11 : 1)))}│`);
      console.log(` │ Mode:      ${(f.mode.value || '?').padEnd(28)}│`);
      if (f.theirQTH?.value)
        console.log(` │ QTH:       ${f.theirQTH.value.padEnd(28)}│`);
      console.log(` │ My Call:   ${(f.myCallsign.value || '?').padEnd(28)}│`);
      console.log(` │ Status:    ${draft.status.padEnd(28)}│`);
      console.log(` └────────────────────────────────────────┘`);
    }
  } else {
    console.log('\n No QSO drafts produced.');
  }

  await pipeline.dispose();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
