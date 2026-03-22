import type { ILLMProvider, LLMResult, LLMOptions } from '../../types/providers.js';

/**
 * A no-op LLM provider for testing.
 */
export class NullLLMProvider implements ILLMProvider {
  readonly name = 'null';

  async initialize(): Promise<void> {}

  async complete(prompt: string, _options?: LLMOptions): Promise<LLMResult> {
    return {
      text: '',
      provider: this.name,
    };
  }

  async dispose(): Promise<void> {}
}
