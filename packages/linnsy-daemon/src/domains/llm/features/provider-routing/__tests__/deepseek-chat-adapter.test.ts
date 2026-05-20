import { createUserMessage, type AiMessage } from '@linnlabs/linnkit/contracts';
import { describe, expect, test } from 'vitest';

import {
  createLinnsyFenceRegistry,
  LINNSY_FENCE_KINDS
} from '../../../../agent-run/features/context-engineering/fences.js';
import type { LinnsyModelConfig } from '../../model-registry/model-registry.js';
import { createSdkProviderFactory, type OpenAiClientPort } from '../sdk-provider-factory.js';

describe('DeepSeek chat adapter', () => {
  test('maps reasoning_details sidecar to reasoning_content before sending chat completions', async () => {
    const requests: unknown[] = [];
    const openAi = openAiClient({
      createChatCompletion(request) {
        requests.push(request);
        return Promise.resolve({ choices: [{ message: { content: 'ok' } }] });
      }
    });
    const provider = createDeepseekProvider(openAi);

    await provider.complete({
      model: deepseekModel(),
      messages: [
        createUserMessage('user_input', 'hi'),
        assistantToolCallMessage(),
        toolOutputMessage()
      ]
    });

    expect(requests).toHaveLength(1);
    const body = requests[0] as Record<string, unknown>;
    const messages = body.messages as Array<Record<string, unknown>>;
    const assistant = messages.find((message) => message.role === 'assistant');
    expect(assistant?.reasoning_content).toBe('Need a tool.');
    expect(assistant?.reasoning_details).toBeUndefined();
    expect(Array.isArray(assistant?.tool_calls)).toBe(true);
  });

  test('formats Linnsy context_injection fences before sending chat completions', async () => {
    const requests: unknown[] = [];
    const openAi = openAiClient({
      createChatCompletion(request) {
        requests.push(request);
        return Promise.resolve({ choices: [{ message: { content: 'ok' } }] });
      }
    });
    const provider = createDeepseekProvider(openAi);

    await provider.complete({
      model: deepseekModel(),
      messages: [
        createUserMessage('context_injection', 'pause the old task', {
          fenceKind: LINNSY_FENCE_KINDS.userInterjection,
          fenceAttrs: { source: 'owner-message' }
        })
      ]
    });

    expect(requests).toHaveLength(1);
    const body = requests[0] as Record<string, unknown>;
    const messages = body.messages as Array<Record<string, unknown>>;
    expect(messages[0]).toEqual({
      role: 'user',
      content: '<user-interjection source="owner-message">\npause the old task\n</user-interjection>'
    });
  });

  test('maps response reasoning_content back to linnkit reasoning_details', async () => {
    const openAi = openAiClient({
      createChatCompletion() {
        return Promise.resolve({
          choices: [
            {
              message: {
                content: 'done',
                reasoning_content: 'DeepSeek private reasoning.'
              }
            }
          ]
        });
      }
    });
    const provider = createDeepseekProvider(openAi);

    await expect(provider.complete({
      model: deepseekModel(),
      messages: [createUserMessage('user_input', 'hello')]
    })).resolves.toEqual({
      content: 'done',
      reasoning_details: [
        {
          provider: 'deepseek',
          type: 'reasoning_content',
          reasoning_content: 'DeepSeek private reasoning.'
        }
      ]
    });
  });

  test('streams reasoning_content as visible thought while preserving replay sidecar', async () => {
    const openAi = openAiClient({
      streamChatCompletion() {
        return streamFrom([
          { choices: [{ delta: { reasoning_content: 'Need a tool.' } }] },
          { choices: [{ delta: { content: 'I will check.' } }] }
        ]);
      }
    });
    const provider = createDeepseekProvider(openAi);
    const events: string[] = [];

    await provider.stream({
      model: { ...deepseekModel(), modelName: 'deepseek-v4-pro' },
      messages: [createUserMessage('user_input', 'hello')]
    }, {
      onThought: (thought) => events.push(`thought:${thought}`),
      onContent: (content) => {
        events.push(`content:${typeof content === 'string' ? content : JSON.stringify(content)}`);
      }
    });

    expect(events).toEqual([
      'thought:Need a tool.',
      'content:{"reasoning_details":[{"provider":"deepseek","type":"reasoning_content","reasoning_content":"Need a tool."}]}',
      'content:I will check.'
    ]);
  });

  test('degrades completed tool history when reasoning_details are missing', async () => {
    const requests: unknown[] = [];
    const openAi = openAiClient({
      createChatCompletion(request) {
        requests.push(request);
        return Promise.resolve({ choices: [{ message: { content: 'ok' } }] });
      }
    });
    const provider = createDeepseekProvider(openAi);

    await provider.complete({
      model: deepseekModel(),
      messages: [
        createUserMessage('user_input', 'hi'),
        assistantToolCallMessageWithoutReasoning(),
        toolOutputMessage(),
        createUserMessage('user_input', 'continue')
      ]
    });

    expect(requests).toHaveLength(1);
    const body = requests[0] as Record<string, unknown>;
    const messages = body.messages as Array<Record<string, unknown>>;
    const toolCallLeak = messages.find((message) => Array.isArray(message.tool_calls));
    const toolRoleLeak = messages.find((message) => message.role === 'tool');
    const degradedAssistant = messages.find((message) => {
      return message.role === 'assistant' &&
        typeof message.content === 'string' &&
        message.content.includes('Tool call recall_memory') &&
        message.content.includes('Tool result call_1');
    });

    expect(toolCallLeak).toBeUndefined();
    expect(toolRoleLeak).toBeUndefined();
    expect(degradedAssistant).toBeDefined();
  });

  test('strips reasoning replay fields when thinking is disabled', async () => {
    const requests: unknown[] = [];
    const openAi = openAiClient({
      createChatCompletion(request) {
        requests.push(request);
        return Promise.resolve({ choices: [{ message: { content: 'ok' } }] });
      }
    });
    const provider = createDeepseekProvider(openAi);

    await provider.complete({
      model: {
        ...deepseekModel(),
        providerOptions: {
          openai: {
            requestExtraBody: {
              thinking: { type: 'disabled' }
            }
          }
        }
      },
      messages: [
        createUserMessage('user_input', 'hi'),
        assistantToolCallMessage(),
        toolOutputMessage()
      ]
    });

    expect(requests).toHaveLength(1);
    const body = requests[0] as Record<string, unknown>;
    const messages = body.messages as Array<Record<string, unknown>>;
    const assistant = messages.find((message) => message.role === 'assistant');
    expect(assistant?.reasoning_content).toBeUndefined();
    expect(assistant?.reasoning_details).toBeUndefined();
  });
});

function createDeepseekProvider(openAi: OpenAiClientPort) {
  return createSdkProviderFactory({
    openAiClientFactory: () => openAi,
    fenceRegistry: createLinnsyFenceRegistry()
  })({
    provider: 'deepseek',
    apiProtocol: 'openai_chat',
    apiKey: 'key'
  });
}

function deepseekModel(): LinnsyModelConfig {
  return {
    id: 'deepseek.v4',
    provider: 'deepseek',
    modelName: 'deepseek-v4-flash',
    apiProtocol: 'openai_chat',
    apiKeyEnv: 'LINNSY_DEEPSEEK_KEY'
  };
}

function openAiClient(overrides: Partial<OpenAiClientPort>): OpenAiClientPort {
  return {
    createChatCompletion() {
      return Promise.resolve({});
    },
    streamChatCompletion() {
      return emptyStream();
    },
    createResponse() {
      return Promise.resolve({});
    },
    streamResponse() {
      return emptyStream();
    },
    ...overrides
  };
}

function assistantToolCallMessage(): AiMessage {
  return {
    id: 'assistant_tool_call_1',
    role: 'assistant',
    type: 'tool_calls',
    content: 'I will inspect.',
    timestamp: 1,
    metadata: {
      reasoning_details: [
        {
          provider: 'deepseek',
          type: 'reasoning_content',
          reasoning_content: 'Need a tool.'
        }
      ],
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'recall_memory', arguments: '{"query":"water"}' }
        }
      ]
    }
  };
}

function assistantToolCallMessageWithoutReasoning(): AiMessage {
  return {
    id: 'assistant_tool_call_without_reasoning',
    role: 'assistant',
    type: 'tool_calls',
    content: 'I will inspect.',
    timestamp: 1,
    metadata: {
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'recall_memory', arguments: '{"query":"water"}' }
        }
      ]
    }
  };
}

function toolOutputMessage(): AiMessage {
  return {
    id: 'tool_output_1',
    role: 'tool',
    type: 'tool_output',
    content: 'memory result',
    timestamp: 2,
    metadata: {
      tool_call_id: 'call_1',
      tool_name: 'recall_memory'
    }
  };
}

async function* emptyStream(): AsyncIterable<unknown> {}

async function* streamFrom(events: unknown[]): AsyncIterable<unknown> {
  for (const event of events) {
    await Promise.resolve();
    yield event;
  }
}
