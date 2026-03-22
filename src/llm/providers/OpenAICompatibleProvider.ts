import type { ILLMProvider, LLMResult, LLMOptions } from '../../types/providers.js';
import { createLogger, type ILogger } from '../../utils/logger.js';

/**
 * Configuration for OpenAI-compatible LLM provider.
 * Works with OpenAI GPT and Alibaba Qwen (via compatible mode).
 */
export interface OpenAICompatibleConfig {
  /** API key */
  apiKey: string;
  /** Base URL (default: OpenAI) */
  baseURL?: string;
  /** Model name (default: 'gpt-4o-mini') */
  model?: string;
  /** Logger */
  logger?: ILogger;
}

/**
 * LLM provider using OpenAI-compatible API.
 *
 * Supports:
 * - OpenAI GPT: default baseURL
 * - Alibaba Qwen: baseURL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
 * - Any other OpenAI-compatible API
 */
export class OpenAICompatibleProvider implements ILLMProvider {
  readonly name: string;
  private readonly config: OpenAICompatibleConfig;
  private client: any = null;
  private readonly logger: ILogger;

  constructor(config: OpenAICompatibleConfig) {
    this.config = config;
    this.name = config.baseURL?.includes('dashscope') ? 'qwen' : 'openai';
    this.logger = createLogger('LLMProvider', config.logger);
  }

  async initialize(): Promise<void> {
    try {
      const { default: OpenAI } = await import('openai');
      this.client = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseURL,
      });
      this.logger.info('initialized', { provider: this.name });
    } catch {
      throw new Error(
        'Failed to initialize LLM provider. Install "openai" package: npm install openai'
      );
    }
  }

  async complete(prompt: string, options?: LLMOptions): Promise<LLMResult> {
    if (!this.client) {
      throw new Error('LLM provider not initialized. Call initialize() first.');
    }

    const model = this.config.model ?? 'gpt-4o-mini';
    const messages: Array<{ role: string; content: string }> = [];

    if (options?.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const requestParams: Record<string, unknown> = {
      model,
      messages,
      max_tokens: options?.maxTokens ?? 1024,
      temperature: options?.temperature ?? 0.1,
    };

    if (options?.jsonMode) {
      requestParams.response_format = { type: 'json_object' };
    }

    try {
      const response = await this.client.chat.completions.create(requestParams);
      const choice = response.choices?.[0];

      return {
        text: choice?.message?.content ?? '',
        usage: response.usage ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
        } : undefined,
        provider: this.name,
      };
    } catch (err) {
      this.logger.error('completion failed', err);
      throw err;
    }
  }

  async dispose(): Promise<void> {
    this.client = null;
  }
}
