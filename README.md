# ham-qso-ai

**English** | [中文](./README.zh-CN.md)

AI-powered automatic QSO logging from voice streams for amateur radio.

## Overview

`ham-qso-ai` extracts structured QSO (contact) log entries from amateur radio voice communications. It processes continuous audio streams and produces draft QSO logs with callsigns, signal reports, and contact details.

**Every processing stage is pluggable.** Choose rule-based (free, fast, offline) or LLM-based (accurate, multilingual) implementations for each layer, or bring your own.

## Architecture

```
Audio + Metadata
  → [Segmenter]          IVAD interface          (default: EnergyVAD)
  → [ASR]                IASRProvider interface   (WhisperProvider / DashScopeASR / custom)
  → [Feature Extractor]  IFeatureExtractor        (RuleBased / LLM / Hybrid / custom)
  → [Session Engine]     deterministic state machine (not pluggable)
  → [Field Resolver]     IFieldResolver           (VotingFieldResolver / custom)
  → QSO Draft events
```

### Design Principles

1. **Split problem into stages** — don't dump everything into one LLM call
2. **AI does transcription & semantic understanding**, deterministic logic does state management
3. **Every stage is replaceable** via interface — swap implementations without touching other layers
4. **Candidate pool, not overwrite** — field values are voted on across mentions, not last-write-wins
5. **Decision tracing** — every extracted field carries provenance (source, confidence, evidence)
6. **High-quality drafts first** — generate candidates with confidence scores, let users confirm

## Installation

```bash
npm install ham-qso-ai

# For OpenAI Whisper / GPT / Qwen (OpenAI-compatible):
npm install openai
```

## Quick Start

### Minimal Setup (rules only, no LLM cost)

```typescript
import { QSOPipeline, WhisperProvider } from 'ham-qso-ai';

const pipeline = new QSOPipeline({
  asr: {
    primary: new WhisperProvider({ apiKey: process.env.OPENAI_API_KEY }),
  },
  session: { myCallsign: 'W1AW' },
});

pipeline.on('qso:ready', (draft) => {
  console.log(`QSO with ${draft.fields.theirCallsign.value}`);
  console.log(`RST Sent: ${draft.fields.rstSent.value}`);
});

await pipeline.start();

// Push audio chunks from your radio
pipeline.pushAudio({
  samples: pcmFloat32,
  sampleRate: 48000,
  direction: 'rx',  // or 'tx' for transmit
  timestamp: Date.now(),
});
```

### Full Setup (LLM-enhanced extraction)

```typescript
import {
  QSOPipeline,
  WhisperProvider,
  DashScopeASRProvider,
  OpenAICompatibleProvider,
  LLMFeatureExtractor,
  HybridFeatureExtractor,
  RuleBasedFeatureExtractor,
} from 'ham-qso-ai';

const llm = new OpenAICompatibleProvider({
  apiKey: process.env.OPENAI_API_KEY,
});
await llm.initialize();

const pipeline = new QSOPipeline({
  asr: {
    primary: new DashScopeASRProvider({
      apiKey: process.env.DASHSCOPE_API_KEY,
      hotWords: ['W1AW', 'BV2XMT'],  // boost callsign recognition
    }),
    fallback: new WhisperProvider({
      apiKey: process.env.OPENAI_API_KEY,
    }),
  },
  llm: { provider: llm },
  session: { myCallsign: 'W1AW', languageHint: 'en' },

  // Use hybrid extractor: rules first, LLM for gaps
  extractor: new HybridFeatureExtractor(
    new RuleBasedFeatureExtractor(),
    new LLMFeatureExtractor(llm),
  ),
});
```

## Pluggable Stages

### Segmenter (`IVAD`)

Cuts continuous audio into voice turns.

| Implementation | Description | Pros | Cons |
|---|---|---|---|
| **`EnergyVAD`** (default) | RMS energy-based voice detection | Fast, free, offline | Sensitive to noise threshold |
| Custom | Implement `IVAD` interface | Full control | - |

```typescript
// Custom segmenter
const pipeline = new QSOPipeline({
  segmenter: new MyCustomVAD(),
  // ...
});
```

### ASR Provider (`IASRProvider`)

Transcribes audio turns to text.

| Implementation | Description | Pros | Cons |
|---|---|---|---|
| **`WhisperProvider`** | OpenAI Whisper / gpt-4o-transcribe | High quality, multilingual | Costs money, requires network |
| **`DashScopeASRProvider`** | Alibaba Paraformer | **Hot word support** (callsigns!), good CJK | China-optimized |
| **`NullASRProvider`** | Returns predefined text | Testing | Not for production |
| Custom | Implement `IASRProvider` | Full control | - |

```typescript
// OpenAI
new WhisperProvider({
  apiKey: 'sk-...',
  model: 'gpt-4o-mini-transcribe',  // or 'whisper-1'
})

// Alibaba DashScope with hot words
new DashScopeASRProvider({
  apiKey: 'sk-...',
  hotWords: ['BV2XMT', 'JA1ABC'],  // boosts recognition of these callsigns
})
```

### Feature Extractor (`IFeatureExtractor`)

Extracts callsigns, RST, closing signals, names, QTH from transcribed text.

| Implementation | Description | Pros | Cons |
|---|---|---|---|
| **`RuleBasedFeatureExtractor`** (default) | Regex patterns + phonetic alphabet decoder | Free, fast, offline, deterministic | Limited to known patterns |
| **`LLMFeatureExtractor`** | Delegates to LLM with structured prompts | Accurate, handles edge cases, multilingual | Costs money, slower |
| **`HybridFeatureExtractor`** | Rules first, LLM fills gaps | Best of both worlds | Slightly more complex |
| Custom | Implement `IFeatureExtractor` | Full control | - |

```typescript
// Rule-only (default, free)
extractor: new RuleBasedFeatureExtractor()

// LLM-only (most accurate)
extractor: new LLMFeatureExtractor(llmProvider)

// Hybrid: rules first, LLM for what rules miss
extractor: new HybridFeatureExtractor(
  new RuleBasedFeatureExtractor(),
  new LLMFeatureExtractor(llmProvider),
  { llmThreshold: 0.5 }  // trigger LLM when rule confidence < 0.5
)
```

### Field Resolver (`IFieldResolver`)

Resolves extracted candidates into final field values.

| Implementation | Description | Pros | Cons |
|---|---|---|---|
| **`VotingFieldResolver`** (default) | Candidate pool with voting, time decay, source weighting | Deterministic, transparent | No semantic disambiguation |
| Custom | Implement `IFieldResolver` | Full control | - |

### LLM Provider (`ILLMProvider`)

Used by `LLMFeatureExtractor` and `HybridFeatureExtractor`.

| Implementation | Description |
|---|---|
| **`OpenAICompatibleProvider`** | Works with OpenAI GPT **and** Alibaba Qwen (same API) |
| **`NullLLMProvider`** | No-op for testing |
| Custom | Implement `ILLMProvider` |

```typescript
// OpenAI GPT
new OpenAICompatibleProvider({
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o-mini',
})

// Alibaba Qwen (same SDK, different baseURL)
new OpenAICompatibleProvider({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  model: 'qwen-plus',
})
```

## Configuration Examples

### Budget-friendly (rules + cheap ASR)

```typescript
new QSOPipeline({
  asr: { primary: new WhisperProvider({ apiKey, model: 'whisper-1' }) },
  session: { myCallsign: 'W1AW' },
  // Uses RuleBasedFeatureExtractor and VotingFieldResolver by default
});
```

### Best accuracy (hybrid extraction + hot words)

```typescript
const llm = new OpenAICompatibleProvider({ apiKey });
await llm.initialize();

new QSOPipeline({
  asr: {
    primary: new DashScopeASRProvider({ apiKey: dsKey, hotWords: ['W1AW'] }),
    fallback: new WhisperProvider({ apiKey }),
  },
  extractor: new HybridFeatureExtractor(
    new RuleBasedFeatureExtractor(),
    new LLMFeatureExtractor(llm),
  ),
  session: { myCallsign: 'W1AW' },
});
```

### Chinese QSO optimized

```typescript
new QSOPipeline({
  asr: {
    primary: new DashScopeASRProvider({
      apiKey: dsKey,
      hotWords: ['BV2XMT', 'BY1AA'],
    }),
  },
  extractor: new HybridFeatureExtractor(
    new RuleBasedFeatureExtractor(),  // handles 七三, 五九, 北京的B, etc.
    new LLMFeatureExtractor(new OpenAICompatibleProvider({
      apiKey: dsKey,
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
    })),
  ),
  session: { myCallsign: 'BV2XMT', languageHint: 'zh' },
});
```

## Events

| Event | Description |
|-------|-------------|
| `qso:draft` | New QSO draft created (session entered SEEKING state) |
| `qso:updated` | Draft fields updated (new turn processed) |
| `qso:ready` | All required fields resolved with high confidence |
| `qso:closed` | QSO ended (73 detected, frequency change, or timeout) |
| `turn:transcribed` | A voice turn was transcribed and features extracted |
| `error` | Non-fatal pipeline error |

## QSO Session State Machine

```
IDLE ──(callsign detected)──→ SEEKING ──(both sides confirmed)──→ LOCKED
  ↑                              │ timeout                          │
  └──────────────────────────────┘                                  │
  ↑                                                                 ↓
  └──── CLOSED ←──(73 + silence)──── HOLD ←──────(long silence)─────┘
                                       │
                                       └──(new turn)──→ LOCKED
```

- **IDLE**: No active QSO
- **SEEKING**: Callsign detected but not yet confirmed as a QSO
- **LOCKED**: QSO in progress, both parties identified
- **HOLD**: Long silence, waiting for continuation or close
- **CLOSED**: QSO ended (terminal state)

## TX/RX Direction

The pipeline automatically handles both participating and monitoring modes:

- **`direction: 'tx'`** — Transmit audio. Speaker identity is known (= `myCallsign`).
- **`direction: 'rx'`** — Receive audio. Speaker identity is inferred from content.

If you only push `rx` chunks (e.g., SWL monitoring), the pipeline infers speakers from callsign mentions in the transcribed text. No explicit mode switch needed.

## Language Support

The rule-based extractor supports:
- **English**: NATO phonetic alphabet, English number words, English closing phrases
- **Chinese**: 中文数字词 (五九), 中文结束语 (七三/再见/谢谢联络), 中文音标拼读 (北京的B), 中文上下文触发词 (这里是/我的呼号是)

The LLM-based extractor handles any language supported by the LLM provider.

## Custom Implementations

Implement any interface to create your own stage:

```typescript
import type { IFeatureExtractor, ExtractionContext } from 'ham-qso-ai';
import type { TurnFeatures } from 'ham-qso-ai';

class MyExtractor implements IFeatureExtractor {
  async extract(text: string, turnId?: string, context?: ExtractionContext): Promise<TurnFeatures> {
    // Your custom extraction logic
  }
}

const pipeline = new QSOPipeline({
  extractor: new MyExtractor(),
  // ...
});
```

## Testing

```bash
npm test        # run all tests
npm run build   # build for distribution
```

The test suite includes:
- Unit tests for all extraction rules (callsigns, RST, phonetic alphabet, closing signals)
- Chinese language extraction tests
- State machine transition tests
- Candidate pool voting/scoring tests
- End-to-end integration tests with simulated QSO conversations

## License

Apache-2.0
