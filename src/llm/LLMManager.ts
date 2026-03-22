import type { ILLMProvider, LLMResult, LLMOptions } from '../types/providers.js';
import { createLogger, type ILogger } from '../utils/logger.js';

/**
 * LLM Manager handles LLM requests with error handling and graceful degradation.
 * LLM failures are non-fatal — the pipeline continues without LLM results.
 */
export class LLMManager {
  private readonly provider: ILLMProvider;
  private readonly logger: ILogger;

  constructor(provider: ILLMProvider, logger?: ILogger) {
    this.provider = provider;
    this.logger = createLogger('LLMManager', logger);
  }

  async initialize(): Promise<void> {
    await this.provider.initialize();
    this.logger.info('initialized', { provider: this.provider.name });
  }

  /**
   * Send a completion request. Returns null on failure (graceful degradation).
   */
  async complete(prompt: string, options?: LLMOptions): Promise<LLMResult | null> {
    try {
      return await this.provider.complete(prompt, options);
    } catch (err) {
      this.logger.warn('LLM request failed, degrading gracefully', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async dispose(): Promise<void> {
    await this.provider.dispose();
  }
}
