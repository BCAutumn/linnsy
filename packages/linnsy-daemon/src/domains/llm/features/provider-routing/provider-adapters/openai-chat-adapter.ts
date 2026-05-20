import { isRecord } from '../../../../../shared/json.js';
import { buildOpenAiChatRequest } from '../codecs/openai-chat.js';
import type {
  LinnsyLlmProvider,
  LinnsyLlmProviderRequest,
  LinnsyProviderFactoryConfig,
  LinnsyStreamCallbacks
} from '../provider-router.js';
import {
  appendStreamUsage,
  appendUsage,
  firstChoice,
  readToolCallChunks,
  runProviderOperation
} from './shared.js';
import type { OpenAiClientPort, SdkProviderAdapter, SdkProviderAdapterDependencies } from './types.js';

export class OpenAiChatAdapter implements SdkProviderAdapter {
  public createProvider(
    config: LinnsyProviderFactoryConfig,
    dependencies: SdkProviderAdapterDependencies
  ): LinnsyLlmProvider {
    return new OpenAiChatProvider(dependencies.openAiClientFactory(config), dependencies);
  }
}

class OpenAiChatProvider implements LinnsyLlmProvider {
  public constructor(
    private readonly client: OpenAiClientPort,
    private readonly dependencies: Pick<SdkProviderAdapterDependencies, 'fenceRegistry'>
  ) {}

  public async complete(request: LinnsyLlmProviderRequest): Promise<unknown> {
    return runProviderOperation(request, async (signal) => {
      const response = await this.client.createChatCompletion(
        buildOpenAiChatRequest(request.model, request.messages, request.options, {
          fenceRegistry: this.dependencies.fenceRegistry
        }),
        signal
      );
      return normalizeOpenAiChatResponse(response);
    });
  }

  public async stream(request: LinnsyLlmProviderRequest, callbacks: LinnsyStreamCallbacks): Promise<void> {
    await runProviderOperation(request, async (signal) => {
      const stream = this.client.streamChatCompletion(
        buildOpenAiChatRequest(request.model, request.messages, request.options, {
          fenceRegistry: this.dependencies.fenceRegistry
        }),
        signal
      );

      for await (const event of stream) {
        emitOpenAiChatStreamEvent(event, callbacks);
      }
    });
  }
}

function normalizeOpenAiChatResponse(response: unknown): Record<string, unknown> {
  const choice = firstChoice(response);
  const message = isRecord(choice?.message) ? choice.message : undefined;
  const result: Record<string, unknown> = {};

  if (typeof message?.content === 'string') {
    result.content = message.content;
  }
  if (Array.isArray(message?.tool_calls)) {
    result.tool_calls = message.tool_calls;
  }
  appendUsage(result, response);
  return result;
}

function emitOpenAiChatStreamEvent(event: unknown, callbacks: LinnsyStreamCallbacks): void {
  const choice = firstChoice(event);
  const delta = isRecord(choice?.delta) ? choice.delta : undefined;

  if (typeof delta?.content === 'string') {
    callbacks.onContent?.(delta.content);
  }
  const toolCallChunks = readToolCallChunks(delta?.tool_calls);
  if (toolCallChunks.length > 0) {
    callbacks.onContent?.({ tool_calls: toolCallChunks });
  }
  if (typeof choice?.finish_reason === 'string') {
    callbacks.onFinish?.(choice.finish_reason);
  }
  appendStreamUsage(event, callbacks);
}
