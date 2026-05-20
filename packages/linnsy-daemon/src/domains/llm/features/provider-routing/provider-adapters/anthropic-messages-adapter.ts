import type { ToolCall } from '@linnlabs/linnkit/ports';

import { isRecord } from '../../../../../shared/json.js';
import { buildAnthropicMessagesRequest } from '../codecs/anthropic-messages.js';
import type {
  LinnsyLlmProvider,
  LinnsyLlmProviderRequest,
  LinnsyProviderFactoryConfig,
  LinnsyStreamCallbacks
} from '../provider-router.js';
import { appendUsage, invalidCodecPayload, runProviderOperation } from './shared.js';
import type { AnthropicClientPort, SdkProviderAdapter, SdkProviderAdapterDependencies } from './types.js';

export class AnthropicMessagesAdapter implements SdkProviderAdapter {
  public createProvider(
    config: LinnsyProviderFactoryConfig,
    dependencies: SdkProviderAdapterDependencies
  ): LinnsyLlmProvider {
    return new AnthropicMessagesProvider(dependencies.anthropicClientFactory(config), dependencies);
  }
}

class AnthropicMessagesProvider implements LinnsyLlmProvider {
  public constructor(
    private readonly client: AnthropicClientPort,
    private readonly dependencies: Pick<SdkProviderAdapterDependencies, 'fenceRegistry'>
  ) {}

  public async complete(request: LinnsyLlmProviderRequest): Promise<unknown> {
    return runProviderOperation(request, async (signal) => {
      const response = await this.client.createMessage(
        buildAnthropicMessagesRequest(request.model, request.messages, request.options, {
          fenceRegistry: this.dependencies.fenceRegistry
        }),
        signal
      );
      return normalizeAnthropicMessageResponse(response);
    });
  }

  public async stream(request: LinnsyLlmProviderRequest, callbacks: LinnsyStreamCallbacks): Promise<void> {
    await runProviderOperation(request, async (signal) => {
      const stream = this.client.streamMessage(
        buildAnthropicMessagesRequest(request.model, request.messages, request.options, {
          fenceRegistry: this.dependencies.fenceRegistry
        }),
        signal
      );

      for await (const event of stream) {
        emitAnthropicStreamEvent(event, callbacks);
      }
    });
  }
}

function normalizeAnthropicMessageResponse(response: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const text: string[] = [];
  const toolCalls: ToolCall[] = [];
  const reasoningDetails: unknown[] = [];

  if (!isRecord(response) || !Array.isArray(response.content)) {
    throw invalidCodecPayload('Anthropic message response must contain a content array');
  }

  for (const block of response.content) {
    if (!isRecord(block) || typeof block.type !== 'string') {
      throw invalidCodecPayload('Anthropic content block must be an object with a string type');
    }

    switch (block.type) {
      case 'text':
        if (typeof block.text !== 'string') {
          throw invalidCodecPayload('Anthropic text block must contain string text');
        }
        text.push(block.text);
        break;
      case 'thinking':
        if (typeof block.thinking !== 'string') {
          throw invalidCodecPayload('Anthropic thinking block must contain string thinking');
        }
        reasoningDetails.push(block);
        break;
      case 'tool_use':
        if (typeof block.id !== 'string' || typeof block.name !== 'string') {
          throw invalidCodecPayload('Anthropic tool_use block must contain string id and name');
        }
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input ?? {})
          }
        });
        break;
      case 'redacted_thinking':
        reasoningDetails.push(block);
        break;
      default:
        throw invalidCodecPayload(`Anthropic content block type ${block.type} is unsupported`);
    }
  }

  if (text.length > 0) {
    result.content = text.join('');
  }
  if (toolCalls.length > 0) {
    result.tool_calls = toolCalls;
  }
  if (reasoningDetails.length > 0) {
    result.reasoning_details = reasoningDetails;
  }
  appendUsage(result, response);
  return result;
}

function emitAnthropicStreamEvent(event: unknown, callbacks: LinnsyStreamCallbacks): void {
  if (!isRecord(event)) {
    return;
  }

  const delta = isRecord(event.delta) ? event.delta : undefined;
  if (event.type === 'content_block_delta' && delta?.type === 'text_delta' && typeof delta.text === 'string') {
    callbacks.onContent?.(delta.text);
  } else if (
    event.type === 'content_block_delta' &&
    delta?.type === 'thinking_delta' &&
    typeof delta.thinking === 'string'
  ) {
    callbacks.onThought?.(delta.thinking);
  } else if (event.type === 'message_delta') {
    if (event.usage !== undefined) {
      callbacks.onUsage?.(event.usage);
    }
    if (typeof delta?.stop_reason === 'string') {
      callbacks.onFinish?.(delta.stop_reason);
    }
  }
}
