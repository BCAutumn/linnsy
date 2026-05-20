import type { AiMessage } from '@linnlabs/linnkit/contracts';
import {
  formatAgentLlmMessages,
  type NativeToolCallingMessage
} from '@linnlabs/linnkit/context-manager';
import type { LlmCallOptions } from '@linnlabs/linnkit/ports';

import type { LinnsyModelConfig } from '../../model-registry/model-registry.js';
import { resolveCodecFormatOptions, type CodecFormatOptions } from './codec-format-options.js';

export type AnthropicMessageContent = string | Array<{
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}>;

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicMessageContent;
}

export interface AnthropicThinkingOption {
  type: 'enabled';
  budget_tokens: number;
}

export interface AnthropicMessagesRequest {
  model: string;
  system?: string;
  messages: AnthropicMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  tools?: unknown[];
  thinking?: AnthropicThinkingOption;
}

export function buildAnthropicMessagesRequest(
  model: LinnsyModelConfig,
  messages: AiMessage[],
  options: LlmCallOptions & { signal?: AbortSignal } = {},
  formatOptions?: CodecFormatOptions
): AnthropicMessagesRequest {
  const defaults = model.requestDefaults;
  const { fenceRegistry } = resolveCodecFormatOptions(formatOptions);
  assertAnthropicToolMessages(messages);
  const request: AnthropicMessagesRequest = {
    model: model.modelName,
    messages: []
  };

  for (const message of formatAgentLlmMessages(messages, {
    fenceRegistry
  })) {
    if (message.role === 'system') {
      request.system = appendSystem(request.system, message.content);
    } else {
      request.messages.push(toAnthropicMessage(message));
    }
  }

  const maxTokens = options.max_tokens ?? defaults?.maxTokens;
  if (maxTokens !== undefined) {
    request.max_tokens = maxTokens;
  }
  const temperature = options.temperature ?? defaults?.temperature;
  if (temperature !== undefined) {
    request.temperature = temperature;
  }
  const topP = options.top_p ?? defaults?.topP;
  if (topP !== undefined) {
    request.top_p = topP;
  }
  if (options.tools !== undefined) {
    request.tools = options.tools;
  }

  const thinking = buildThinking(model);
  if (thinking !== undefined) {
    request.thinking = thinking;
  }

  return request;
}

function assertAnthropicToolMessages(messages: AiMessage[]): void {
  for (const message of messages) {
    if (message.role !== 'tool') {
      continue;
    }
    if (typeof message.metadata?.tool_call_id !== 'string') {
      throw new Error('Anthropic tool_result requires metadata.tool_call_id');
    }
  }
}

function buildThinking(model: LinnsyModelConfig): AnthropicThinkingOption | undefined {
  const supportsReasoning = model.capabilities?.supportsReasoning ?? true;
  if (!supportsReasoning) {
    return undefined;
  }
  if (model.reasoning?.enabled !== true) {
    return undefined;
  }
  const budget = model.providerOptions?.anthropic?.thinkingBudgetTokens
    ?? model.reasoning.budgetTokens;
  if (budget === undefined) {
    return undefined;
  }
  return { type: 'enabled', budget_tokens: budget };
}

function toAnthropicMessage(message: NativeToolCallingMessage): AnthropicMessage {
  const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);

  if (message.role === 'assistant') {
    return { role: 'assistant', content };
  }

  if (message.role === 'tool') {
    return {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: readToolCallId(message),
          content
        }
      ]
    };
  }

  return { role: 'user', content };
}

function appendSystem(existing: string | undefined, next: string): string {
  return existing === undefined ? next : `${existing}\n\n${next}`;
}

function readToolCallId(message: NativeToolCallingMessage): string {
  if (message.role === 'tool') {
    return message.tool_call_id;
  }

  throw new Error('Anthropic tool_result requires metadata.tool_call_id');
}
