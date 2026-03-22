# ham-qso-ai

基于 AI 的业余无线电语音通联自动日志系统。

[English](./README.md) | **中文**

## 概述

`ham-qso-ai` 从业余无线电语音通联中自动提取结构化 QSO（通联）日志。处理连续音频流，输出包含呼号、信号报告等信息的通联日志草稿。

**每个处理阶段均可插拔。** 可为每一层自由选择基于规则（免费、快速、离线）或基于 LLM（准确、多语言）的实现，也可接入自定义实现。

## 架构

```
音频 + 元数据
  → [分段器]        IVAD 接口             (默认: EnergyVAD)
  → [语音识别]      IASRProvider 接口      (WhisperProvider / DashScopeASR / 自定义)
  → [特征提取]      IFeatureExtractor 接口  (规则 / LLM / 混合 / 自定义)
  → [会话引擎]      确定性状态机            (不可插拔)
  → [字段解析]      IFieldResolver 接口     (VotingFieldResolver / 自定义)
  → QSO 草稿事件
```

### 设计原则

1. **分阶段处理** — 不把所有问题丢给一个 LLM 调用
2. **AI 负责转写和语义理解**，确定性逻辑负责状态管理
3. **每个阶段可替换** — 通过接口约束，替换实现无需改动其他层
4. **候选池投票而非覆盖** — 字段值通过多次提及累计置信度，而非后来者覆盖
5. **决策追踪** — 每个提取的字段都携带来源、置信度、证据
6. **优先生成高质量草稿** — 带置信度的候选值，由用户确认

## 安装

```bash
npm install ham-qso-ai

# 使用 OpenAI Whisper / GPT / 千问 (OpenAI 兼容) 时:
npm install openai
```

## 快速上手

### 最简配置（仅规则，无 LLM 开销）

```typescript
import { QSOPipeline, WhisperProvider } from 'ham-qso-ai';

const pipeline = new QSOPipeline({
  asr: {
    primary: new WhisperProvider({ apiKey: process.env.OPENAI_API_KEY }),
  },
  session: { myCallsign: 'BV2XMT' },
});

pipeline.on('qso:ready', (draft) => {
  console.log(`通联对象: ${draft.fields.theirCallsign.value}`);
  console.log(`发送 RST: ${draft.fields.rstSent.value}`);
});

await pipeline.start();

// 推入音频数据
pipeline.pushAudio({
  samples: pcmFloat32,       // Float32Array, 归一化到 [-1, 1]
  sampleRate: 48000,
  direction: 'rx',           // 'rx' = 接收, 'tx' = 发射
  timestamp: Date.now(),
});
```

### 完整配置（LLM 增强提取）

```typescript
import {
  QSOPipeline,
  DashScopeASRProvider,
  OpenAICompatibleProvider,
  HybridFeatureExtractor,
  RuleBasedFeatureExtractor,
  LLMFeatureExtractor,
} from 'ham-qso-ai';

const llm = new OpenAICompatibleProvider({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  model: 'qwen-plus',
});
await llm.initialize();

const pipeline = new QSOPipeline({
  asr: {
    primary: new DashScopeASRProvider({
      apiKey: process.env.DASHSCOPE_API_KEY,
      hotWords: ['BV2XMT', 'BY1AA'],  // 热词提升呼号识别率
    }),
  },
  llm: { provider: llm },
  session: { myCallsign: 'BV2XMT', languageHint: 'zh' },

  // 混合提取: 规则优先，规则不足时 LLM 补充
  extractor: new HybridFeatureExtractor(
    new RuleBasedFeatureExtractor(),
    new LLMFeatureExtractor(llm),
  ),
});
```

## 可插拔阶段

### 分段器 (`IVAD`)

将连续音频切分为语音轮次 (Turn)。

| 实现 | 说明 | 优点 | 缺点 |
|------|------|------|------|
| **`EnergyVAD`** (默认) | 基于 RMS 能量的语音检测 | 快速、免费、离线 | 对噪声阈值敏感 |
| 自定义 | 实现 `IVAD` 接口 | 完全可控 | - |

### 语音识别 (`IASRProvider`)

将语音轮次转写为文本。

| 实现 | 说明 | 优点 | 缺点 |
|------|------|------|------|
| **`WhisperProvider`** | OpenAI Whisper / gpt-4o-transcribe | 高质量、多语言 | 收费、需网络 |
| **`DashScopeASRProvider`** | 阿里 Paraformer | **热词支持**（呼号！）、中文优秀 | 中国区优化 |
| **`NullASRProvider`** | 返回预设文本 | 测试用 | 非生产用途 |
| 自定义 | 实现 `IASRProvider` 接口 | 完全可控 | - |

```typescript
// OpenAI Whisper
new WhisperProvider({
  apiKey: 'sk-...',
  model: 'gpt-4o-mini-transcribe',  // 或 'whisper-1'
})

// 阿里 DashScope + 热词
new DashScopeASRProvider({
  apiKey: 'sk-...',
  hotWords: ['BV2XMT', 'JA1ABC'],  // 提升这些呼号的识别率
})
```

### 特征提取 (`IFeatureExtractor`)

从转写文本中提取呼号、RST、结束语、姓名、QTH 等信息。

| 实现 | 说明 | 优点 | 缺点 |
|------|------|------|------|
| **`RuleBasedFeatureExtractor`** (默认) | 正则匹配 + 音标字母解码 | 免费、快速、离线、确定性 | 仅限已知模式 |
| **`LLMFeatureExtractor`** | 通过结构化提示词交由 LLM 处理 | 准确、处理边缘情况、多语言 | 收费、较慢 |
| **`HybridFeatureExtractor`** | 规则优先，LLM 补充不足 | 兼顾速度和准确性 | 配置稍复杂 |
| 自定义 | 实现 `IFeatureExtractor` 接口 | 完全可控 | - |

**混合模式触发逻辑:**

```
规则提取
    ↓
有高置信度呼号? ──是──→ 直接返回（不调 LLM）
    ↓ 否
有信号标记(roger/73/CQ)? ──是──→ 直接返回（纯信号轮次）
    ↓ 否
呼号存在但置信度低? ──是──→ 调 LLM 补强
    ↓ 否（完全为空）
调 LLM ──→ 合并结果
    ↓ LLM 失败
降级返回规则结果
```

### 字段解析 (`IFieldResolver`)

将提取的候选值解析为最终字段值。

| 实现 | 说明 | 优点 | 缺点 |
|------|------|------|------|
| **`VotingFieldResolver`** (默认) | 候选池投票 + 时间衰减 + 来源加权 | 确定性、透明可追溯 | 无语义消歧 |
| 自定义 | 实现 `IFieldResolver` 接口 | 完全可控 | - |

### LLM 提供者 (`ILLMProvider`)

供 `LLMFeatureExtractor` 和 `HybridFeatureExtractor` 使用。

| 实现 | 说明 |
|------|------|
| **`OpenAICompatibleProvider`** | 同时支持 OpenAI GPT 和阿里千问（同一 API 协议） |
| **`NullLLMProvider`** | 测试用空实现 |
| 自定义 | 实现 `ILLMProvider` 接口 |

```typescript
// OpenAI GPT
new OpenAICompatibleProvider({
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o-mini',
})

// 阿里千问（同一 SDK，不同 baseURL）
new OpenAICompatibleProvider({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  model: 'qwen-plus',
})
```

## 配置示例

### 经济型（仅规则 + 低价 ASR）

```typescript
new QSOPipeline({
  asr: { primary: new WhisperProvider({ apiKey, model: 'whisper-1' }) },
  session: { myCallsign: 'BV2XMT' },
  // 默认使用 RuleBasedFeatureExtractor 和 VotingFieldResolver
});
```

### 最高精度（混合提取 + 热词）

```typescript
const llm = new OpenAICompatibleProvider({ apiKey });
await llm.initialize();

new QSOPipeline({
  asr: {
    primary: new DashScopeASRProvider({ apiKey: dsKey, hotWords: ['BV2XMT'] }),
    fallback: new WhisperProvider({ apiKey }),
  },
  extractor: new HybridFeatureExtractor(
    new RuleBasedFeatureExtractor(),
    new LLMFeatureExtractor(llm),
  ),
  session: { myCallsign: 'BV2XMT' },
});
```

### 中文通联优化

```typescript
new QSOPipeline({
  asr: {
    primary: new DashScopeASRProvider({
      apiKey: dsKey,
      hotWords: ['BV2XMT', 'BY1AA'],
    }),
  },
  extractor: new HybridFeatureExtractor(
    new RuleBasedFeatureExtractor(),  // 支持: 七三、五九、北京的B 等
    new LLMFeatureExtractor(new OpenAICompatibleProvider({
      apiKey: dsKey,
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
    })),
  ),
  session: { myCallsign: 'BV2XMT', languageHint: 'zh' },
});
```

## 事件

| 事件 | 说明 |
|------|------|
| `qso:draft` | 新建 QSO 草稿（会话进入 SEEKING 状态） |
| `qso:updated` | 草稿字段更新（处理了新的语音轮次） |
| `qso:ready` | 所有关键字段以高置信度解析完成 |
| `qso:closed` | QSO 结束（检测到 73、频率变化或超时） |
| `turn:transcribed` | 一个语音轮次完成转写和特征提取 |
| `error` | 非致命管线错误 |

## QSO 会话状态机

```
IDLE ──(检测到呼号)──→ SEEKING ──(双方确认)──→ LOCKED
  ↑                        │ 超时                 │
  └────────────────────────┘                      │
  ↑                                               ↓
  └──── CLOSED ←──(73+静默)──── HOLD ←──(长静默)──┘
                                  │
                                  └──(新轮次)──→ LOCKED
```

- **IDLE**: 无活跃 QSO
- **SEEKING**: 检测到呼号但尚未确认为有效通联
- **LOCKED**: 通联进行中，双方已确认
- **HOLD**: 长时间静默，等待继续或关闭
- **CLOSED**: 通联结束（终态）

## TX/RX 方向

管线自动处理参与通联和收听监控两种场景：

- **`direction: 'tx'`** — 发射音频，说话者身份已知（= `myCallsign`）
- **`direction: 'rx'`** — 接收音频，说话者身份从内容推断

如果只推入 `rx` 数据（例如 SWL 短波收听），管线会从转写文本中的呼号提及推断说话者身份。无需手动切换模式。

## 语言支持

规则引擎支持：
- **英文**: NATO 音标字母表、英文数字词、英文结束语
- **中文**: 中文数字词（五九）、中文结束语（七三/再见/谢谢联络）、中文音标拼读（北京的B）、中文上下文触发词（这里是/我的呼号是）

LLM 提取器支持 LLM 提供者所支持的所有语言。

## 自定义实现

实现任意接口来创建自定义阶段：

```typescript
import type { IFeatureExtractor, ExtractionContext } from 'ham-qso-ai';
import type { TurnFeatures } from 'ham-qso-ai';

class MyExtractor implements IFeatureExtractor {
  async extract(text: string, turnId?: string, context?: ExtractionContext): Promise<TurnFeatures> {
    // 自定义提取逻辑
  }
}

const pipeline = new QSOPipeline({
  extractor: new MyExtractor(),
  // ...
});
```

## 测试

```bash
npm test        # 运行所有测试
npm run build   # 构建
```

测试套件包含：
- 所有提取规则的单元测试（呼号、RST、音标字母、结束语）
- 中文提取专项测试
- LLM 提取器 JSON 解析与校验测试（含自动纠错）
- 混合模式 LLM 触发逻辑测试
- 状态机转换测试
- 候选池投票/评分测试
- 端到端集成测试（模拟完整 QSO 对话）

## 协议

Apache-2.0
