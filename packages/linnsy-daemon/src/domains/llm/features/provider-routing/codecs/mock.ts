import type { AgentAiEngine, AgentAiEngineStreamContent, LlmCallOptions } from '@linnlabs/linnkit/ports';
import type { AiMessage } from '@linnlabs/linnkit/contracts';

export interface MockAiEngineResponse {
  content?: string;
  thought?: string;
  usage?: unknown;
}

export function createMockAiEngine(response: MockAiEngineResponse): AgentAiEngine {
  return {
    chatCompletion(): Promise<unknown> {
      return Promise.resolve(response.content === undefined ? {} : { content: response.content });
    },

    chatCompletionStream(
      modelId: string,
      messages: AiMessage[],
      options?: LlmCallOptions & {
        signal?: AbortSignal;
        stream_options?: {
          include_usage?: boolean;
        };
      },
      onContent?: (content: AgentAiEngineStreamContent) => void,
      _onError?: (error: Error) => void,
      onFinish?: (reason: string) => void,
      onThought?: (thought: string) => void,
      onUsage?: (usage: unknown) => void
    ): Promise<void> {
      void modelId;
      void messages;
      void options;

      if (response.thought !== undefined) {
        onThought?.(response.thought);
      }
      if (response.content !== undefined) {
        onContent?.(response.content);
      }
      if (response.usage !== undefined) {
        onUsage?.(response.usage);
      }

      onFinish?.('stop');
      return Promise.resolve();
    }
  };
}
