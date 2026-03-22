import type { QSOPipelineConfig } from '../types/config.js';
import type { IVAD } from '../segmentation/types.js';
import { QSOPipeline } from './QSOPipeline.js';
import { SyllabicVAD } from '../segmentation/SyllabicVAD.js';
import { OmniConversationProcessor } from '../processor/OmniConversationProcessor.js';
import { ChainedTurnProcessor } from '../processor/ChainedTurnProcessor.js';
import { ChainedConversationProcessor } from '../processor/ChainedConversationProcessor.js';
import { WhisperProvider } from '../asr/providers/WhisperProvider.js';
import { Qwen3ASRProvider } from '../asr/providers/Qwen3ASRProvider.js';
import { OpenAICompatibleProvider } from '../llm/providers/OpenAICompatibleProvider.js';
import { HybridFeatureExtractor } from '../extraction/HybridFeatureExtractor.js';
import { RuleBasedFeatureExtractor } from '../extraction/FeatureExtractor.js';
import { LLMFeatureExtractor } from '../extraction/LLMFeatureExtractor.js';

/**
 * Preset options for quick pipeline creation.
 */
export interface PresetOptions {
  /** API key */
  apiKey: string;
  /** Operator's callsign (default: 'LISTENER' for SWL mode) */
  myCallsign?: string;
  /** Language hint (default: 'zh') */
  languageHint?: string;
  /** Override the default model */
  model?: string;
  /** Custom VAD/segmenter */
  segmenter?: IVAD;
  /** Silence timeout in ms (default: 20000) */
  silenceTimeout?: number;
  /** Hold timeout in ms (default: 60000) */
  holdTimeout?: number;
}

/**
 * Create a QSO pipeline with sensible defaults for common configurations.
 *
 * @example
 * ```typescript
 * // DashScope (Qwen) — recommended, uses omni conversation mode
 * const pipeline = createPipeline('dashscope', { apiKey: 'sk-xxx' });
 *
 * // DashScope chained mode (ASR + LLM separately)
 * const pipeline = createPipeline('dashscope-chained', { apiKey: 'sk-xxx' });
 *
 * // OpenAI (Whisper + GPT-4o)
 * const pipeline = createPipeline('openai', { apiKey: 'sk-xxx' });
 *
 * // Local/offline (rule-based only, no API calls)
 * const pipeline = createPipeline('local', { apiKey: '' });
 * ```
 */
export function createPipeline(
  preset: 'dashscope' | 'dashscope-omni' | 'dashscope-chained' | 'openai' | 'local',
  options: PresetOptions,
): QSOPipeline {
  const myCallsign = options.myCallsign ?? 'LISTENER';
  const languageHint = options.languageHint ?? 'zh';
  const segmenter = options.segmenter ?? new SyllabicVAD({
    minSpeechDuration: 500,
    silenceTimeout: 2000,
    maxTurnDuration: 30000,
    snrThresholdDb: 4,
    noiseFloorAlpha: 0.01,
    syllabicModulationThreshold: 0.1,
  });

  const baseConfig: Partial<QSOPipelineConfig> = {
    session: { myCallsign, languageHint },
    segmenter,
    silenceTimeout: options.silenceTimeout ?? 20000,
    holdTimeout: options.holdTimeout ?? 60000,
  };

  switch (preset) {
    case 'dashscope': {
      // Recommended: ASR (qwen3-asr-flash) + multi-turn LLM conversation (qwen3-omni-flash)
      return new QSOPipeline({
        ...baseConfig,
        processor: new ChainedConversationProcessor({
          asr: new Qwen3ASRProvider({
            apiKey: options.apiKey,
            model: 'qwen3-asr-flash',
          }),
          llmApiKey: options.apiKey,
          llmModel: options.model ?? 'qwen3.5-flash',
          language: languageHint,
          myCallsign,
        }),
        session: baseConfig.session!,
      });
    }

    case 'dashscope-omni': {
      // Full omni mode: single multimodal conversation (audio + text)
      return new QSOPipeline({
        ...baseConfig,
        processor: new OmniConversationProcessor({
          apiKey: options.apiKey,
          model: options.model ?? 'qwen3-omni-flash',
        }),
        session: baseConfig.session!,
      });
    }

    case 'dashscope-chained': {
      // DashScope with separate ASR + LLM
      const llm = new OpenAICompatibleProvider({
        apiKey: options.apiKey,
        model: options.model ?? 'qwen3.5-flash',
        baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      });
      return new QSOPipeline({
        ...baseConfig,
        processor: new ChainedTurnProcessor({
          asr: new Qwen3ASRProvider({
            apiKey: options.apiKey,
            model: 'qwen3-asr-flash',
          }),
          extractor: new HybridFeatureExtractor(
            new RuleBasedFeatureExtractor(),
            new LLMFeatureExtractor(llm, { maxHistoryTurns: 8 }),
          ),
          language: languageHint,
          myCallsign,
        }),
        session: baseConfig.session!,
      });
    }

    case 'openai': {
      // OpenAI: Whisper + GPT-4o
      const llm = new OpenAICompatibleProvider({
        apiKey: options.apiKey,
        model: options.model ?? 'gpt-4o',
      });
      return new QSOPipeline({
        ...baseConfig,
        processor: new ChainedTurnProcessor({
          asr: new WhisperProvider({
            apiKey: options.apiKey,
            model: 'whisper-1',
          }),
          extractor: new HybridFeatureExtractor(
            new RuleBasedFeatureExtractor(),
            new LLMFeatureExtractor(llm, { maxHistoryTurns: 8 }),
          ),
          language: languageHint,
          myCallsign,
        }),
        session: baseConfig.session!,
      });
    }

    case 'local': {
      // Local: rule-based only, no API calls
      // Requires a local ASR provider to be useful — placeholder with null
      return new QSOPipeline({
        ...baseConfig,
        processor: new ChainedTurnProcessor({
          asr: new Qwen3ASRProvider({
            apiKey: options.apiKey,
            model: 'qwen3-asr-flash',
          }),
          extractor: new RuleBasedFeatureExtractor(),
          language: languageHint,
          myCallsign,
        }),
        session: baseConfig.session!,
      });
    }

    default:
      throw new Error(`Unknown preset: ${preset}`);
  }
}
