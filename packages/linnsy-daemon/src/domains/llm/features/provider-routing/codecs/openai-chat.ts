import type { AiMessage } from '@linnlabs/linnkit/contracts';
import {
  formatAgentLlmMessages,
  type NativeToolCallingMessage
} from '@linnlabs/linnkit/context-manager';
import type { LlmCallOptions } from '@linnlabs/linnkit/ports';

import type { LinnsyModelConfig } from '../../model-registry/model-registry.js';
import { resolveCodecFormatOptions, type CodecFormatOptions } from './codec-format-options.js';

export type OpenAiChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: unknown[];
  reasoning_content?: string;
  reasoning_details?: unknown[];
};

export interface OpenAiChatRequest {
  model: string;
  messages: OpenAiChatMessage[];
  tools?: unknown[];
  tool_choice?: LlmCallOptions['tool_choice'];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
}

export function buildOpenAiChatRequest(
  model: LinnsyModelConfig,
  messages: AiMessage[],
  options: LlmCallOptions & { signal?: AbortSignal } = {},
  formatOptions?: CodecFormatOptions
): OpenAiChatRequest {
  const defaults = model.requestDefaults;
  // 先 spread provider-native extras（如 deepseek `thinking` / `reasoning_effort`），
  // 再写入 codec 显式已知字段，确保 model/messages/temperature/... 永远覆盖
  // 同名 extras，防止配置侧用 extra_body 篡改核心 wire 字段。
  const extras = model.providerOptions?.openai?.requestExtraBody;
  const { fenceRegistry } = resolveCodecFormatOptions(formatOptions);
  const result: OpenAiChatRequest = {
    ...(extras ?? {}),
    model: model.modelName,
    messages: formatAgentLlmMessages(messages, {
      fenceRegistry
    }).map(toOpenAiChatMessage)
  };

  const temperature = options.temperature ?? defaults?.temperature;
  if (temperature !== undefined) {
    result.temperature = temperature;
  }
  const topP = options.top_p ?? defaults?.topP;
  if (topP !== undefined) {
    result.top_p = topP;
  }
  const maxTokens = options.max_tokens ?? defaults?.maxTokens;
  if (maxTokens !== undefined) {
    result.max_tokens = maxTokens;
  }
  if (options.tools !== undefined) {
    result.tools = options.tools;
  }
  if (options.tool_choice !== undefined) {
    result.tool_choice = options.tool_choice;
  }

  return result;
}

function toOpenAiChatMessage(message: NativeToolCallingMessage): OpenAiChatMessage {
  if (message.role === 'system' || message.role === 'user') {
    return { role: message.role, content: message.content };
  }
  if (message.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.tool_call_id,
      content: message.content
    };
  }

  const result: OpenAiChatMessage = {
    role: 'assistant',
    content: message.content
  };
  if ('tool_calls' in message) {
    result.tool_calls = message.tool_calls;
  }
  if ('reasoning_details' in message && Array.isArray(message.reasoning_details)) {
    result.reasoning_details = message.reasoning_details;
  }
  return result;
}
