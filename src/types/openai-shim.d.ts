// Type shim for optional peer dependency 'openai'
// The actual types come from the openai package when installed
declare module 'openai' {
  export default class OpenAI {
    constructor(config: { apiKey: string; baseURL?: string });
    audio: {
      transcriptions: {
        create(params: Record<string, unknown>): Promise<{
          text: string;
          language?: string;
          words?: Array<{ word: string; start: number; end: number }>;
        }>;
      };
    };
    chat: {
      completions: {
        create(params: Record<string, unknown>): Promise<{
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { prompt_tokens: number; completion_tokens: number };
        }>;
      };
    };
  }
}
