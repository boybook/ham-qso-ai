# ham-qso-ai

**English** | [中文](./README.zh-CN.md)

AI-powered automatic QSO logging from voice streams for amateur radio.

## Overview

`ham-qso-ai` extracts structured QSO (contact) log entries from amateur radio voice communications. It processes continuous audio streams and produces draft QSO logs with callsigns, signal reports, and contact details.

**Station-centric model**: Each callsign heard on the air accumulates its own context (QTH, name, equipment) in a persistent `StationRegistry`. QSO Drafts are composed from Station data, not stored per-QSO.

## Architecture

```
Audio + Metadata
  → [Segmenter]         IVAD                (EnergyVAD / SyllabicVAD)
  → [Turn Processor]    ITurnProcessor      (ChainedConversation / Omni / Chained)
  → [Session Engine]    state machine + StationRegistry
  → [Draft Emitter]     QSO Drafts with Station participants
```

### Core Concepts

- **StationRegistry** — Long-lived knowledge base of amateur radio stations. Each callsign gets a `StationContext` with QTH, name, grid, equipment. Persists across QSOs and sessions (via export/import).
- **ITurnProcessor** — Unified abstraction replacing the old ASR + Extractor chain. Three implementations:
  - `ChainedConversationProcessor` — ASR (fast) + multi-turn LLM conversation (context-aware). **Recommended.**
  - `OmniConversationProcessor` — Single multimodal LLM (audio + text in one conversation).
  - `ChainedTurnProcessor` — ASR + feature extractor (legacy compatible).
- **QSO Draft** — References Station participants, not inline fields. RST is directional (A→B, B→A).

### Design Principles

1. **Station-centric** — callsign = entity with accumulated context
2. **Pluggable stages** — swap any implementation via interface
3. **Candidate pool voting** — field values accumulate confidence, not last-write-wins
4. **Async dual pipeline** — ASR returns fast, LLM enriches in background
5. **Decision tracing** — every field carries provenance

## Installation

```bash
npm install ham-qso-ai openai
```

## Quick Start

### One-line setup (recommended)

```typescript
import { createPipeline } from 'ham-qso-ai';

// DashScope (Qwen): ASR + multi-turn LLM conversation
const pipeline = createPipeline('dashscope', {
  apiKey: process.env.DASHSCOPE_API_KEY!,
  myCallsign: 'LISTENER',  // SWL mode
  languageHint: 'zh',
});

pipeline.on('qso:ready', (draft) => {
  for (const station of draft.stations) {
    console.log(`${station.callsign}: QTH=${station.qth}`);
  }
});

await pipeline.start();
pipeline.pushAudio({ samples, sampleRate, direction: 'rx', timestamp: Date.now() });
```

### Available presets

| Preset | Description |
|--------|-------------|
| `'dashscope'` | qwen3-asr-flash + qwen3.5-flash conversation (recommended for Chinese) |
| `'dashscope-omni'` | qwen3-omni-flash multimodal conversation |
| `'openai'` | Whisper + GPT-4o |
| `'local'` | Rule-based extraction only |

### Manual configuration

```typescript
import { QSOPipeline, OmniConversationProcessor, SyllabicVAD } from 'ham-qso-ai';

const pipeline = new QSOPipeline({
  processor: new OmniConversationProcessor({
    apiKey: process.env.DASHSCOPE_API_KEY!,
    model: 'qwen3-omni-flash',
  }),
  session: { myCallsign: 'BG7ABS', languageHint: 'zh' },
  segmenter: new SyllabicVAD({ snrThresholdDb: 4 }),
});
```

## Station Registry

The registry accumulates station info across QSOs:

```typescript
// After pipeline runs, inspect accumulated stations
const stations = pipeline.stationRegistry.getAll();
for (const s of stations) {
  console.log(`${s.callsign}: QTH=${s.resolveQTH()?.value}, seen ${s.turnCount}x`);
}

// Export for persistence
const snapshot = pipeline.stationRegistry.export();
fs.writeFileSync('stations.json', JSON.stringify(snapshot));

// Import in next session
const saved = JSON.parse(fs.readFileSync('stations.json', 'utf-8'));
pipeline.stationRegistry.import(saved);
```

## Events

| Event | Description |
|-------|-------------|
| `qso:draft` | New QSO draft created (callsign detected) |
| `qso:updated` | Draft fields updated (new turn or late LLM result) |
| `qso:ready` | Station identified with sufficient confidence |
| `qso:closed` | QSO ended (73, frequency change, or timeout) |
| `turn:transcribed` | A voice turn was transcribed and features extracted |
| `error` | Non-fatal pipeline error |

## QSO Draft Structure

```typescript
interface QSODraft {
  stations: QSOParticipant[];  // callsign, QTH, name, grid, equipment
  rstAtoB: ResolvedField;     // RST: station A → station B
  rstBtoA: ResolvedField;     // RST: station B → station A
  fields: QSOFields;          // frequency, mode, time, myCallsign
  turns: ProcessedTurn[];
  status: 'draft' | 'ready' | 'final';
}
```

## Language Support

- **Chinese**: NATO 音标中文音译解码, 中文数字词 (五九), 中文结束语 (七三/再见), 区域说法 (七区电台)
- **English**: NATO phonetic alphabet, English number words, English closing phrases
- **Multilingual**: LLM-based extraction handles any language

## Testing

```bash
npm test        # run all tests
npm run build   # build for distribution
```

## License

Apache-2.0
