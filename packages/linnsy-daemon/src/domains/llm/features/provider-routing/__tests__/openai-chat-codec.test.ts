import {
  createAssistantMessage,
  createSystemMessage,
  createToolMessage,
  createUserMessage,
  type ToolCallWire
} from '@linnlabs/linnkit/contracts';
import { describe, expect, test } from 'vitest';

import { createLinnsyFenceRegistry, LINNSY_FENCE_KINDS } from '../../../../agent-run/features/context-engineering/fences.js';
import { buildOpenAiChatRequest } from '../codecs/openai-chat.js';
import type { LinnsyModelConfig } from '../../model-registry/model-registry.js';

describe('buildOpenAiChatRequest', () => {
  test('maps linnkit messages and strips internal-only options', () => {
    const request = buildOpenAiChatRequest(model('gpt-5-mini'), [
      createUserMessage('user_input', 'hello'),
      createAssistantMessage('final_answer', 'hi')
    ], {
      tools: [
        {
          type: 'function',
          function: {
            name: 'recall_memory',
            parameters: { type: 'object', properties: {} }
          }
        }
      ],
      tool_choice: 'auto',
      temperature: 0.2,
      retry_policy: 'none',
      cloud_quota_fallback_model_id: 'fallback',
      signal: AbortSignal.timeout(1000)
    });

    expect(request).toEqual({
      model: 'gpt-5-mini',
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' }
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'recall_memory',
            parameters: { type: 'object', properties: {} }
          }
        }
      ],
      tool_choice: 'auto',
      temperature: 0.2
    });
  });

  test('maps system and tool messages and optional sampling options', () => {
    const request = buildOpenAiChatRequest(model('gpt-5-mini'), [
      createSystemMessage('system_prompt', 'stay concise'),
      createToolMessage('memory result', 'call_1', 'recall_memory')
    ], {
      top_p: 0.9,
      max_tokens: 128
    });

    expect(request).toEqual({
      model: 'gpt-5-mini',
      messages: [
        { role: 'system', content: 'stay concise' },
        { role: 'tool', tool_call_id: 'call_1', content: 'memory result' }
      ],
      top_p: 0.9,
      max_tokens: 128
    });
  });

  test('preserves native tool replay fields for agent conversations', () => {
    const toolCalls: ToolCallWire[] = [
      {
        id: 'call_list_tasks',
        type: 'function',
        function: {
          name: 'list_tasks',
          arguments: '{}'
        }
      }
    ];
    const request = buildOpenAiChatRequest(model('gpt-5-mini'), [
      createAssistantMessage('tool_calls', '', { tool_calls: toolCalls }),
      createToolMessage('{"tasks":[]}', 'call_list_tasks', 'list_tasks')
    ]);

    expect(request.messages).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: toolCalls
      },
      {
        role: 'tool',
        tool_call_id: 'call_list_tasks',
        content: '{"tasks":[]}'
      }
    ]);
  });

  test('formats Linnsy context_injection fences before building chat messages', () => {
    const request = buildOpenAiChatRequest(model('gpt-5-mini'), [
      createUserMessage('context_injection', 'cron fired', {
        fenceKind: LINNSY_FENCE_KINDS.systemEvent,
        fenceAttrs: { kind: 'cron-fire', jobId: 'cron_1' }
      }),
      createUserMessage('user_input', 'continue')
    ], {}, { fenceRegistry: createLinnsyFenceRegistry() });

    expect(request.messages).toEqual([
      {
        role: 'user',
        content: '<system-event kind="cron-fire" jobId="cron_1">\ncron fired\n</system-event>'
      },
      { role: 'user', content: 'continue' }
    ]);
  });

  test('applies model.requestDefaults when caller leaves sampling options unset', () => {
    const request = buildOpenAiChatRequest(
      {
        ...model('gpt-5-mini'),
        requestDefaults: { temperature: 0.4, topP: 0.8, maxTokens: 256 }
      },
      [createUserMessage('user_input', 'hi')]
    );

    expect(request).toMatchObject({
      temperature: 0.4,
      top_p: 0.8,
      max_tokens: 256
    });
  });

  test('merges provider_options.openai.request_extra_body into the body root', () => {
    const request = buildOpenAiChatRequest(
      {
        ...model('deepseek-v4-pro'),
        providerOptions: {
          openai: {
            requestExtraBody: {
              thinking: { type: 'enabled' },
              reasoning_effort: 'high',
              custom_vendor_flag: true
            }
          }
        }
      },
      [createUserMessage('user_input', 'hi')],
      { temperature: 0 }
    );

    const wire = request as unknown as Record<string, unknown>;
    expect(wire.thinking).toEqual({ type: 'enabled' });
    expect(wire.reasoning_effort).toBe('high');
    expect(wire.custom_vendor_flag).toBe(true);
    expect(wire.model).toBe('deepseek-v4-pro');
    expect(wire.temperature).toBe(0);
  });

  test('codec-known fields override conflicting request_extra_body entries', () => {
    const request = buildOpenAiChatRequest(
      {
        ...model('deepseek-v4-pro'),
        providerOptions: {
          openai: {
            requestExtraBody: {
              model: 'evil-model',
              messages: [{ role: 'user', content: 'evil' }],
              temperature: 1.5,
              max_tokens: 9999,
              top_p: 0.1,
              tools: [{ name: 'evil' }],
              tool_choice: 'required',
              extra_keep: 'kept'
            }
          }
        }
      },
      [createUserMessage('user_input', 'hi')],
      {
        temperature: 0,
        top_p: 0.9,
        max_tokens: 128,
        tools: [
          {
            type: 'function',
            function: { name: 'good', parameters: { type: 'object', properties: {} } }
          }
        ],
        tool_choice: 'auto'
      }
    );

    const wire = request as unknown as Record<string, unknown>;
    expect(wire.model).toBe('deepseek-v4-pro');
    expect(wire.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(wire.temperature).toBe(0);
    expect(wire.top_p).toBe(0.9);
    expect(wire.max_tokens).toBe(128);
    expect(wire.tool_choice).toBe('auto');
    expect((wire.tools as Array<Record<string, unknown>>)[0]?.type).toBe('function');
    expect(wire.extra_keep).toBe('kept');
  });

  test('caller options take precedence over model.requestDefaults', () => {
    const request = buildOpenAiChatRequest(
      {
        ...model('gpt-5-mini'),
        requestDefaults: { temperature: 0.4, maxTokens: 256 }
      },
      [createUserMessage('user_input', 'hi')],
      { temperature: 0.1 }
    );

    expect(request.temperature).toBe(0.1);
    expect(request.max_tokens).toBe(256);
  });
});

function model(modelName: string): LinnsyModelConfig {
  return {
    id: `openai.${modelName}`,
    provider: 'openai',
    modelName,
    apiProtocol: 'openai_chat',
    apiKeyEnv: 'LINNSY_OPENAI_KEY'
  };
}
