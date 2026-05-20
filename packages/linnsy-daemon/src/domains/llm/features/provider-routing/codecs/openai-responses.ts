import type { AiMessage } from '@linnlabs/linnkit/contracts';
import {
  formatAgentLlmMessages,
  type NativeToolCallingMessage
} from '@linnlabs/linnkit/context-manager';
import type { LlmCallOptions } from '@linnlabs/linnkit/ports';

import type { LinnsyModelConfig } from '../../model-registry/model-registry.js';
import { resolveCodecFormatOptions, type CodecFormatOptions } from './codec-format-options.js';

export interface OpenAiResponsesInputMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface OpenAiResponsesReasoningOption {
  effort?: 'minimal' | 'low' | 'medium' | 'high';
  summary?: 'auto' | 'concise' | 'detailed';
}

export interface OpenAiResponsesTextOption {
  verbosity?: 'low' | 'medium' | 'high';
}

export interface OpenAiResponsesRequest {
  model: string;
  input: OpenAiResponsesInputMessage[];
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  tools?: unknown[];
  tool_choice?: LlmCallOptions['tool_choice'];
  reasoning?: OpenAiResponsesReasoningOption;
  text?: OpenAiResponsesTextOption;
}

export function buildOpenAiResponsesRequest(
  model: LinnsyModelConfig,
  messages: AiMessage[],
  options: LlmCallOptions & { signal?: AbortSignal } = {},
  formatOptions?: CodecFormatOptions
): OpenAiResponsesRequest {
  const defaults = model.requestDefaults;
  const { fenceRegistry } = resolveCodecFormatOptions(formatOptions);
  const request: OpenAiResponsesRequest = {
    model: model.modelName,
    input: formatAgentLlmMessages(messages, {
      fenceRegistry
    }).map(toResponsesInputMessage)
  };

  const maxOutput = options.max_tokens ?? defaults?.maxTokens;
  if (maxOutput !== undefined) {
    request.max_output_tokens = maxOutput;
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
  if (options.tool_choice !== undefined) {
    request.tool_choice = options.tool_choice;
  }

  const reasoning = buildReasoning(model);
  if (reasoning !== undefined) {
    request.reasoning = reasoning;
  }
  const textVerbosity = model.providerOptions?.openai?.textVerbosity;
  if (textVerbosity !== undefined) {
    request.text = { verbosity: textVerbosity };
  }

  return request;
}

function buildReasoning(model: LinnsyModelConfig): OpenAiResponsesReasoningOption | undefined {
  const supportsReasoning = model.capabilities?.supportsReasoning ?? true;
  if (!supportsReasoning) {
    return undefined;
  }

  const reasoning: OpenAiResponsesReasoningOption = {};
  if (model.reasoning?.effort !== undefined) {
    reasoning.effort = model.reasoning.effort;
  }
  const summary = model.providerOptions?.openai?.reasoningSummary;
  if (summary !== undefined) {
    reasoning.summary = summary;
  }

  if (reasoning.effort === undefined && reasoning.summary === undefined) {
    return undefined;
  }
  return reasoning;
}

function toResponsesInputMessage(message: NativeToolCallingMessage): OpenAiResponsesInputMessage {
  const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);

  if (message.role === 'system') {
    return { role: 'system', content };
  }
  if (message.role === 'assistant') {
    return { role: 'assistant', content };
  }
  if (message.role === 'tool') {
    return { role: 'tool', content };
  }

  return { role: 'user', content };
}
