import { isRecord } from '../../../../../shared/json.js';
import {
  appendDeepseekReasoningDetail,
  buildDeepseekChatRequest,
  createDeepseekReasoningDetail
} from '../codecs/deepseek-chat.js';
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

export class DeepseekChatAdapter implements SdkProviderAdapter {
  public createProvider(
    config: LinnsyProviderFactoryConfig,
    dependencies: SdkProviderAdapterDependencies
  ): LinnsyLlmProvider {
    return new DeepseekChatProvider(dependencies.openAiClientFactory(config), dependencies);
  }
}

class DeepseekChatProvider implements LinnsyLlmProvider {
  public constructor(
    private readonly client: OpenAiClientPort,
    private readonly dependencies: Pick<SdkProviderAdapterDependencies, 'fenceRegistry'>
  ) {}

  public async complete(request: LinnsyLlmProviderRequest): Promise<unknown> {
    return runProviderOperation(request, async (signal) => {
      const response = await this.client.createChatCompletion(
        buildDeepseekChatRequest(request.model, request.messages, request.options, {
          fenceRegistry: this.dependencies.fenceRegistry
        }),
        signal
      );
      return normalizeDeepseekChatResponse(response);
    });
  }

  public async stream(request: LinnsyLlmProviderRequest, callbacks: LinnsyStreamCallbacks): Promise<void> {
    await runProviderOperation(request, async (signal) => {
      const stream = this.client.streamChatCompletion(
        buildDeepseekChatRequest(request.model, request.messages, request.options, {
          fenceRegistry: this.dependencies.fenceRegistry
        }),
        signal
      );

      for await (const event of stream) {
        emitDeepseekChatStreamEvent(event, callbacks);
      }
    });
  }
}

function normalizeDeepseekChatResponse(response: unknown): Record<string, unknown> {
  const choice = firstChoice(response);
  const message = isRecord(choice?.message) ? appendDeepseekReasoningDetail(choice.message) : undefined;
  const result: Record<string, unknown> = {};

  if (typeof message?.content === 'string') {
    result.content = message.content;
  }
  if (Array.isArray(message?.tool_calls)) {
    result.tool_calls = message.tool_calls;
  }
  if (Array.isArray(message?.reasoning_details)) {
    result.reasoning_details = message.reasoning_details;
  }
  appendUsage(result, response);
  return result;
}

function emitDeepseekChatStreamEvent(event: unknown, callbacks: LinnsyStreamCallbacks): void {
  const choice = firstChoice(event);
  const rawDelta = isRecord(choice?.delta) ? choice.delta : undefined;
  const delta = rawDelta === undefined ? undefined : appendDeepseekReasoningDetail(rawDelta);

  if (typeof delta?.content === 'string') {
    callbacks.onContent?.(delta.content);
  }
  const reasoningDetail = createDeepseekReasoningDetail(rawDelta?.reasoning_content);
  if (reasoningDetail !== undefined) {
    // DeepSeek 的 reasoning_content 既是需要回放的 provider sidecar，
    // 也是主人可感知的思考过程；两条通道各司其职，不能互相替代。
    callbacks.onThought?.(reasoningDetail.reasoning_content);
  }
  if (Array.isArray(delta?.reasoning_details)) {
    callbacks.onContent?.({ reasoning_details: delta.reasoning_details });
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
