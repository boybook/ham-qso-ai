# ham-qso-ai

[English](./README.md) | **中文**

AI 驱动的业余无线电语音通联自动日志记录。

## 概述

`ham-qso-ai` 从业余无线电语音通信中提取结构化的 QSO（通联）日志条目。处理连续音频流，生成包含呼号、信号报告和联系详情的 QSO 草稿。

**台站中心模型**：每个听到的呼号在 `StationRegistry` 中积累独立的上下文（QTH、姓名、设备）。QSO 草稿由台站数据组合而成，支持跨会话持久化。

## 架构

```
音频 + 元数据
  → [分割器]         IVAD              (EnergyVAD / SyllabicVAD)
  → [Turn 处理器]    ITurnProcessor    (ChainedConversation / Omni / Chained)
  → [会话引擎]       状态机 + StationRegistry
  → [草稿生成]       含台站参与者的 QSO 草稿
```

### 核心概念

- **StationRegistry** — 长期台站知识库。每个呼号维护 QTH、姓名、网格、设备信息。跨 QSO 和会话持久化。
- **ITurnProcessor** — 统一的 Turn 处理抽象，三种实现：
  - `ChainedConversationProcessor` — ASR（快速）+ 多轮 LLM 对话（上下文感知）。**推荐。**
  - `OmniConversationProcessor` — 单一多模态 LLM（音频+文本同会话）。
  - `ChainedTurnProcessor` — ASR + 特征提取器（兼容旧模式）。

## 安装

```bash
npm install ham-qso-ai openai
```

## 快速开始

```typescript
import { createPipeline } from 'ham-qso-ai';

// 一行启动（百炼平台）
const pipeline = createPipeline('dashscope', {
  apiKey: 'sk-xxx',
  myCallsign: 'LISTENER',  // SWL 监听模式
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

### 预设模式

| 预设 | 说明 |
|------|------|
| `'dashscope'` | qwen3-asr-flash + qwen3.5-flash 多轮对话（推荐中文场景） |
| `'dashscope-omni'` | qwen3-omni-flash 多模态对话 |
| `'openai'` | Whisper + GPT-4o |
| `'local'` | 仅规则提取，无需网络 |

## 台站知识库

```typescript
// 查看积累的台站信息
const stations = pipeline.stationRegistry.getAll();
for (const s of stations) {
  console.log(`${s.callsign}: QTH=${s.resolveQTH()?.value}, 出现 ${s.turnCount} 次`);
}

// 导出持久化
const snapshot = pipeline.stationRegistry.export();
fs.writeFileSync('stations.json', JSON.stringify(snapshot));

// 下次会话导入
const saved = JSON.parse(fs.readFileSync('stations.json', 'utf-8'));
pipeline.stationRegistry.import(saved);
```

## 语言支持

- **中文**：NATO 音标中文音译解码、中文数字词（五九）、中文结束语（七三/再见）、区域说法（七区电台）
- **英文**：NATO 音标字母、英文数字词、英文结束语
- **多语言**：基于 LLM 的提取支持任意语言

## 测试

```bash
npm test
npm run build
```

## 许可证

Apache-2.0
