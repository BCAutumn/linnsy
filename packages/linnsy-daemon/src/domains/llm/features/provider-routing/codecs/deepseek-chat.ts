import type { AiMessage } from '@linnlabs/linnkit/contracts';
import {
  formatAgentLlmMessages,
  type NativeToolCallingMessage
} from '@linnlabs/linnkit/context-manager';
import type { LlmCallOptions } from '@linnlabs/linnkit/ports';

import { isRecord } from '../../../../../shared/json.js';
import type { LinnsyModelConfig } from '../../model-registry/model-registry.js';
import type { OpenAiChatMessage, OpenAiChatRequest } from './openai-chat.js';
import { resolveCodecFormatOptions, type CodecFormatOptions } from './codec-format-options.js';

interface DeepseekReasoningDetail {
  provider: 'deepseek';
  type: 'reasoning_content';
  reasoning_content: string;
}

export function buildDeepseekChatRequest(
  model: LinnsyModelConfig,
  messages: AiMessage[],
  options: LlmCallOptions & { signal?: AbortSignal } = {},
  formatOptions?: CodecFormatOptions
): OpenAiChatRequest {
  const defaults = model.requestDefaults;
  const extras = model.providerOptions?.openai?.requestExtraBody;
  const { fenceRegistry } = resolveCodecFormatOptions(formatOptions);
  const result: OpenAiChatRequest = {
    ...(extras ?? {}),
    model: model.modelName,
    messages: prepareDeepseekMessages(
      formatAgentLlmMessages(messages, {
        fenceRegistry
      }).map(toDeepseekMessage),
      extras
    )
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

export function createDeepseekReasoningDetail(reasoning: unknown): DeepseekReasoningDetail | undefined {
  if (typeof reasoning !== 'string' || reasoning.trim().length === 0) {
    return undefined;
  }

  return {
    provider: 'deepseek',
    type: 'reasoning_content',
    reasoning_content: reasoning
  };
}

export function appendDeepseekReasoningDetail<T extends Record<string, unknown>>(message: T): T {
  const detail = createDeepseekReasoningDetail(message.reasoning_content);
  if (detail === undefined) {
    return message;
  }

  const existing = toUnknownArray(message.reasoning_details);
  return {
    ...message,
    reasoning_details: [...existing, detail]
  };
}

function toUnknownArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: unknown[] = [];
  for (const item of value) {
    result.push(item);
  }
  return result;
}

function toDeepseekMessage(message: NativeToolCallingMessage): OpenAiChatMessage {
  const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);

  if (message.role === 'system') {
    return { role: 'system', content };
  }
  if (message.role === 'tool') {
    return toDeepseekToolMessage(message, content);
  }
  if (message.role === 'assistant') {
    return toDeepseekAssistantMessage(message, content);
  }

  return { role: 'user', content };
}

function toDeepseekAssistantMessage(message: NativeToolCallingMessage, content: string): OpenAiChatMessage {
  const result: OpenAiChatMessage = {
    role: 'assistant',
    content
  };

  if ('tool_calls' in message && Array.isArray(message.tool_calls)) {
    result.content = content.length > 0 ? content : null;
    result.tool_calls = message.tool_calls;
  }

  const reasoningContent = 'reasoning_details' in message
    ? extractDeepseekReasoningContent(message.reasoning_details)
    : undefined;
  if (reasoningContent !== undefined) {
    result.reasoning_content = reasoningContent;
  }

  return result;
}

function toDeepseekToolMessage(message: NativeToolCallingMessage, content: string): OpenAiChatMessage {
  const result: OpenAiChatMessage = {
    role: 'tool',
    content
  };
  if (message.role === 'tool') {
    result.tool_call_id = message.tool_call_id;
  }
  return result;
}

function prepareDeepseekMessages(
  messages: OpenAiChatMessage[],
  requestExtraBody: Record<string, unknown> | undefined
): OpenAiChatMessage[] {
  if (isThinkingDisabled(requestExtraBody)) {
    return stripReasoningReplayFields(messages);
  }

  return degradeCompletedToolInteractionsMissingReasoning(messages);
}

function isThinkingDisabled(requestExtraBody: Record<string, unknown> | undefined): boolean {
  const thinking = requestExtraBody?.thinking;
  return isRecord(thinking) && thinking.type === 'disabled';
}

function stripReasoningReplayFields(messages: OpenAiChatMessage[]): OpenAiChatMessage[] {
  return messages.map((message) => {
    const rest: OpenAiChatMessage = { ...message };
    delete rest.reasoning_content;
    delete rest.reasoning_details;
    return rest;
  });
}

function degradeCompletedToolInteractionsMissingReasoning(
  messages: OpenAiChatMessage[]
): OpenAiChatMessage[] {
  const result: OpenAiChatMessage[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message === undefined) {
      continue;
    }
    if (!hasToolCalls(message) || typeof message.reasoning_content === 'string') {
      result.push(message);
      continue;
    }

    const ids = toolCallIds(message);
    const toolOutputs: Array<Record<string, unknown>> = [];
    let nextIndex = index + 1;
    while (nextIndex < messages.length) {
      const candidate = messages[nextIndex];
      if (candidate === undefined) {
        break;
      }
      if (candidate.role !== 'tool') {
        break;
      }
      const toolCallId = candidate.tool_call_id;
      if (typeof toolCallId !== 'string' || !ids.has(toolCallId)) {
        break;
      }
      toolOutputs.push(candidate);
      nextIndex += 1;
    }

    if (toolOutputs.length === 0) {
      result.push(message);
      continue;
    }

    result.push(degradeToolInteractionToAssistantText(message, toolOutputs));
    index = nextIndex - 1;
  }

  return result;
}

function hasToolCalls(message: OpenAiChatMessage): boolean {
  return message.role === 'assistant' &&
    Array.isArray(message.tool_calls) &&
    message.tool_calls.length > 0;
}

function toolCallIds(message: OpenAiChatMessage): Set<string> {
  const ids = new Set<string>();
  const calls = message.tool_calls;
  if (!Array.isArray(calls)) {
    return ids;
  }

  for (const call of calls) {
    if (!isRecord(call)) {
      continue;
    }
    const id = call.id;
    if (typeof id === 'string' && id.trim().length > 0) {
      ids.add(id);
    }
  }

  return ids;
}

function degradeToolInteractionToAssistantText(
  toolCallsMessage: OpenAiChatMessage,
  toolOutputs: Array<Record<string, unknown>>
): OpenAiChatMessage {
  return {
    role: 'assistant',
    content: [
      stringifyUnknown(toolCallsMessage.content),
      stringifyToolCalls(toolCallsMessage.tool_calls),
      ...toolOutputs.map(stringifyToolOutput)
    ].filter((part): part is string => typeof part === 'string' && part.length > 0).join('\n\n')
  };
}

function stringifyToolCalls(toolCalls: unknown): string | undefined {
  if (!Array.isArray(toolCalls)) {
    return undefined;
  }

  return toolCalls
    .map((toolCall, index) => stringifyToolCall(toolCall, index))
    .join('\n');
}

function stringifyToolCall(toolCall: unknown, index: number): string {
  if (!isRecord(toolCall)) {
    return `Tool call ${String(index + 1)}: ${stringifyUnknown(toolCall) ?? ''}`;
  }

  const fn = isRecord(toolCall.function) ? toolCall.function : undefined;
  const name = typeof fn?.name === 'string' && fn.name.trim().length > 0 ? fn.name : `tool_${String(index + 1)}`;
  const args = stringifyUnknown(fn?.arguments) ?? '{}';
  return `Tool call ${name} args=${args}`;
}

function stringifyToolOutput(toolOutput: Record<string, unknown>): string {
  const toolCallId = typeof toolOutput.tool_call_id === 'string' && toolOutput.tool_call_id.trim().length > 0
    ? toolOutput.tool_call_id
    : 'unknown';
  return `Tool result ${toolCallId}: ${stringifyUnknown(toolOutput.content) ?? ''}`;
}

function stringifyUnknown(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint' ||
      typeof value === 'symbol'
    ) {
      return String(value);
    }
    return '[unserializable]';
  }
}

function extractDeepseekReasoningContent(reasoningDetails: unknown): string | undefined {
  if (!Array.isArray(reasoningDetails)) {
    return undefined;
  }

  const parts: string[] = [];
  for (const detail of reasoningDetails) {
    if (!isRecord(detail)) {
      continue;
    }
    if (detail.provider !== 'deepseek' || detail.type !== 'reasoning_content') {
      continue;
    }
    const reasoning = detail.reasoning_content;
    if (typeof reasoning === 'string' && reasoning.trim().length > 0) {
      parts.push(reasoning);
    }
  }

  return parts.length > 0 ? parts.join('\n') : undefined;
}
