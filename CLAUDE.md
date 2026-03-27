# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test              # Run all tests (vitest, 243 tests)
npm run build         # Build with tsup (ESM output to dist/)
npm run typecheck     # Strict TypeScript check (tsc --noEmit)
npm run lint          # ESLint
npm run dev           # Watch mode build

# Run a single test file
npx vitest run tests/unit/extraction/CallsignExtractor.test.ts

# Run demo with real radio recording
npx tsx demo/run.ts                # Batch mode (requires .env with API keys)
npx tsx demo/run-streaming.ts      # Real-time streaming mode
```

## Architecture

**Station-centric model**: Each callsign accumulates independent context (QTH, name, equipment) in a `StationRegistry`. QSO Drafts reference Station participants, not inline fields.

### Data Flow

```
AudioChunk → VAD (segmentation) → Turn → enqueueTurn()
  → ITurnProcessor.processTurn(audio) → { text, features }
  → StationRegistry.feedTurn() (route QTH/name to inferred speaker)
  → QSOSessionEngine.processTurn() (route to candidate, drive state machine)
  → QSODraftEmitter.update() → emit('qso:updated' | 'qso:ready')
```

### Key Abstractions

**ITurnProcessor** — Unified turn processing, three implementations:
- `ChainedConversationProcessor`: ASR (fast, returns immediately) + multi-turn LLM conversation (async, context-aware). **Recommended for production.** LLM results arrive via `onLateFeatures` callback.
- `OmniConversationProcessor`: Single multimodal LLM (audio+text in one chat session).
- `ChainedTurnProcessor`: ASR + IFeatureExtractor chain (legacy compatible).

**StationRegistry** — Long-lived knowledge base. Each callsign → `StationContext` with CandidatePool-backed fields. Supports `export()`/`import()` for cross-session persistence.

**QSOSessionEngine** — XState v5 state machine (idle→seeking→locked⇌hold→closed) + `QSOCandidateManager` routing turns to candidates by affinity score.

**VotingFieldResolver** — Candidate pool voting, not last-write-wins. `resolveStationData()` for callsign/RST/QTH, `resolve()` for QSO-level fields (freq/mode/time).

### Async Turn Queue

VAD produces turns synchronously; API calls are slow. Pipeline uses an async queue:
- `enqueueTurn()` → queue → `processQueue()` processes one at a time (preserves conversation ordering)
- `stop()` calls `drain()` which returns a Promise that resolves when queue is empty
- `ChainedConversationProcessor` fires LLM in background (`fireLLMExtraction`), ASR result returns immediately

### QSO Draft Model

```typescript
QSODraft {
  stations: QSOParticipant[]  // callsign + QTH + name + grid + equipment (from StationRegistry)
  rstAtoB / rstBtoA           // Directional RST (A→B, B→A)
  fields: QSOFields           // QSO-level: frequency, mode, startTime, myCallsign
}
```

`QSOFields` does NOT contain station-specific data (no theirCallsign, theirQTH, etc). Those live in `stations[]`.

### Factory Presets

```typescript
createPipeline('dashscope', { apiKey, myCallsign: 'LISTENER' })  // ASR + LLM conversation
createPipeline('openai', { apiKey, myCallsign: 'W1AW' })         // Whisper + GPT-4o
```

## Key Patterns

- **Qwen3 models**: Pass `enable_thinking: false` as top-level param (NOT `extra_body`) in OpenAI SDK to disable thinking mode.
- **Callsign regex**: ITU standard — prefix must contain a letter. `/^(?:[BFGKIMNRW]|[0-9][A-Z]|[A-Z][0-9]|[A-Z]{2})[0-9][A-Z]{1,4}$/`
- **LLM response parsing**: Shared in `src/extraction/llm-response-parser.ts`. Used by both `LLMFeatureExtractor` and `OmniConversationProcessor`.
- **Speaker inference**: `StationRegistry.inferSpeaker()` uses "这里是"/"this is" patterns to determine which station owns the QTH/name in a turn.
- **Chinese ham radio**: NATO phonetic transliterations (布拉沃=B, 高尔夫=G), district references (七区电台=BG7/BH7), Chinese RST (五九=59).

## Testing

Tests are in `tests/` with unit tests per module and integration tests for the full pipeline. Test fixtures in `tests/fixtures/transcripts/` provide simulated QSO conversations. Integration tests use `NullASRProvider` with scripted transcripts — no API keys needed.
