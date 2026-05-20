import {
  createAssistantMessage,
  createSystemMessage,
  createToolMessage,
  createUserMessage,
  type AiMessage
} from '@linnlabs/linnkit/contracts';
import { describe, expect, test } from 'vitest';

import { buildAnthropicMessagesRequest } from '../codecs/anthropic-messages.js';
import { createLinnsyFenceRegistry, LINNSY_FENCE_KINDS } from '../../../../agent-run/features/context-engineering/fences.js';
import type { LinnsyModelConfig } from '../../model-registry/model-registry.js';

describe('buildAnthropicMessagesRequest', () => {
  test('promotes system messages and maps conversation messages', () => {
    const request = buildAnthropicMessagesRequest(model(), [
      createSystemMessage('system_prompt', 'be useful'),
      createUserMessage('user_input', 'hello'),
      createAssistantMessage('final_answer', 'hi'),
      createToolMessage('memory result', 'call_1', 'recall_memory')
    ], {
      max_tokens: 256,
      temperature: 0.1
    });

    expect(request).toEqual({
      model: 'claude-sonnet',
      system: 'be useful',
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'memory result' }] }
      ],
      max_tokens: 256,
      temperature: 0.1
    });
  });

  test('appends multiple system messages and maps optional tools', () => {
    const request = buildAnthropicMessagesRequest(model(), [
      createSystemMessage('system_prompt', 'first instruction'),
      createSystemMessage('history_summary', 'second instruction'),
      createUserMessage('user_input', 'continue')
    ], {
      top_p: 0.8,
      tools: [
        {
          name: 'recall_memory',
          input_schema: { type: 'object', properties: {} }
        }
      ]
    });

    expect(request).toEqual({
      model: 'claude-sonnet',
      system: 'first instruction\n\nsecond instruction',
      messages: [
        { role: 'user', content: 'continue' }
      ],
      top_p: 0.8,
      tools: [
        {
          name: 'recall_memory',
          input_schema: { type: 'object', properties: {} }
        }
      ]
    });
  });

  test('formats Linnsy context_injection fences as user messages', () => {
    const request = buildAnthropicMessagesRequest(model(), [
      createUserMessage('context_injection', 'pause the old task', {
        fenceKind: LINNSY_FENCE_KINDS.userInterjection,
        fenceAttrs: { source: 'owner-message' }
      })
    ], {}, { fenceRegistry: createLinnsyFenceRegistry() });

    expect(request.messages).toEqual([
      {
        role: 'user',
        content: '<user-interjection source="owner-message">\npause the old task\n</user-interjection>'
      }
    ]);
  });

  test('fails fast when a tool message does not carry the linnkit tool call id', () => {
    const malformedToolMessage: AiMessage = {
      id: 'msg_tool_missing_call_id',
      role: 'tool',
      type: 'tool_output',
      content: 'missing metadata',
      timestamp: 0,
      metadata: {
        tool_name: 'recall_memory'
      }
    };

    expect(() => buildAnthropicMessagesRequest(model(), [malformedToolMessage])).toThrow(
      'Anthropic tool_result requires metadata.tool_call_id'
    );
  });

  test('emits thinking option when reasoning is enabled with a provider budget', () => {
    const request = buildAnthropicMessagesRequest(
      {
        ...model(),
        capabilities: { supportsReasoning: true },
        reasoning: { enabled: true },
        providerOptions: { anthropic: { thinkingBudgetTokens: 4096 } }
      },
      [createUserMessage('user_input', 'plan')]
    );

    expect(request.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 });
  });

  test('falls back to reasoning.budgetTokens when providerOptions budget is absent', () => {
    const request = buildAnthropicMessagesRequest(
      {
        ...model(),
        reasoning: { enabled: true, budgetTokens: 2048 }
      },
      [createUserMessage('user_input', 'plan')]
    );

    expect(request.thinking).toEqual({ type: 'enabled', budget_tokens: 2048 });
  });

  test('omits thinking when capabilities.supportsReasoning is false', () => {
    const request = buildAnthropicMessagesRequest(
      {
        ...model(),
        capabilities: { supportsReasoning: false },
        reasoning: { enabled: true, budgetTokens: 2048 }
      },
      [createUserMessage('user_input', 'plan')]
    );

    expect(request.thinking).toBeUndefined();
  });

  test('uses model.requestDefaults when caller omits sampling options', () => {
    const request = buildAnthropicMessagesRequest(
      {
        ...model(),
        requestDefaults: { temperature: 0.5, topP: 0.7, maxTokens: 1024 }
      },
      [createUserMessage('user_input', 'hi')]
    );

    expect(request).toMatchObject({
      max_tokens: 1024,
      temperature: 0.5,
      top_p: 0.7
    });
  });
});

function model(): LinnsyModelConfig {
  return {
    id: 'anthropic.sonnet',
    provider: 'anthropic',
    modelName: 'claude-sonnet',
    apiProtocol: 'anthropic_messages',
    apiKeyEnv: 'LINNSY_ANTHROPIC_KEY'
  };
}
