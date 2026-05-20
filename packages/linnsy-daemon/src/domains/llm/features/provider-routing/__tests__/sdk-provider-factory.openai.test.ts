import { describe, expect, test } from 'vitest';

import {
  createSdkProviderFactory,
  createUserMessage,
  emptyStream,
  model,
  streamFrom
} from './scenarios/sdk-provider-factory-support.js';
import type { OpenAiClientPort } from './scenarios/sdk-provider-factory-support.js';

describe('createSdkProviderFactory OpenAI adapters', () => {
  test('normalizes OpenAI Chat completions and stream deltas', async () => {
    const openAi: OpenAiClientPort = {
      createChatCompletion() {
        return Promise.resolve({
          choices: [
            {
              message: {
                content: 'done',
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'recall_memory', arguments: '{"query":"water"}' }
                  }
                ]
              }
            }
          ],
          usage: { total_tokens: 9 }
        });
      },
      streamChatCompletion() {
        return streamFrom([
          { choices: [{ delta: { content: 'he' } }] },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: 'call_1', function: { name: 'recall_memory', arguments: '{"q":"' } },
                    { index: 0, function: { arguments: 'water"}' } }
                  ]
                },
                finish_reason: 'tool_calls'
              }
            ],
            usage: { total_tokens: 10 }
          }
        ]);
      },
      createResponse() {
        return Promise.resolve({});
      },
      streamResponse() {
        return emptyStream();
      }
    };
    const factory = createSdkProviderFactory({
      openAiClientFactory: () => openAi
    });
    const provider = factory({
      provider: 'openai',
      apiProtocol: 'openai_chat',
      apiKey: 'key'
    });
    const events: string[] = [];

    await expect(provider.complete({
      model: model('openai_chat'),
      messages: [createUserMessage('user_input', 'hello')]
    })).resolves.toEqual({
      content: 'done',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'recall_memory', arguments: '{"query":"water"}' }
        }
      ],
      usage: { total_tokens: 9 }
    });
    await provider.stream({
      model: model('openai_chat'),
      messages: [createUserMessage('user_input', 'hello')]
    }, {
      onContent: (content) => events.push(typeof content === 'string' ? content : JSON.stringify(content)),
      onUsage: (usage) => events.push(`usage:${JSON.stringify(usage)}`),
      onFinish: (reason) => events.push(`finish:${reason}`)
    });

    expect(events).toEqual([
      'he',
      '{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"recall_memory","arguments":"{\\"q\\":\\""}},{"index":0,"function":{"arguments":"water\\"}"}}]}',
      'finish:tool_calls',
      'usage:{"total_tokens":10}'
    ]);
  });

  test('forwards provider_options.openai.requestExtraBody to OpenAI Chat completions body root', async () => {
    const requests: unknown[] = [];
    const openAi: OpenAiClientPort = {
      createChatCompletion(request) {
        requests.push(request);
        return Promise.resolve({ choices: [{ message: { content: 'ok' } }] });
      },
      streamChatCompletion() {
        return emptyStream();
      },
      createResponse() {
        return Promise.resolve({});
      },
      streamResponse() {
        return emptyStream();
      }
    };
    const factory = createSdkProviderFactory({ openAiClientFactory: () => openAi });
    const provider = factory({
      provider: 'openai',
      apiProtocol: 'openai_chat',
      apiKey: 'key'
    });

    await provider.complete({
      model: {
        ...model('openai_chat'),
        modelName: 'deepseek-v4-pro',
        providerOptions: {
          openai: {
            requestExtraBody: {
              thinking: { type: 'enabled' },
              reasoning_effort: 'high'
            }
          }
        }
      },
      messages: [createUserMessage('user_input', 'hello')],
      options: { temperature: 0 }
    });

    expect(requests).toHaveLength(1);
    const body = requests[0] as Record<string, unknown>;
    expect(body.model).toBe('deepseek-v4-pro');
    expect(body.thinking).toEqual({ type: 'enabled' });
    expect(body.reasoning_effort).toBe('high');
    expect(body.temperature).toBe(0);
  });

  test('calls OpenAI Responses through a reusable SDK client port', async () => {
    const requests: unknown[] = [];
    const openAi: OpenAiClientPort = {
      createChatCompletion() {
        return Promise.resolve({});
      },
      streamChatCompletion() {
        return emptyStream();
      },
      createResponse(request) {
        requests.push(request);
        return Promise.resolve({
          output_text: 'hi',
          usage: { total_tokens: 12 }
        });
      },
      streamResponse() {
        return emptyStream();
      }
    };
    const factory = createSdkProviderFactory({
      openAiClientFactory: () => openAi
    });
    const provider = factory({
      provider: 'openai',
      apiProtocol: 'openai_responses',
      apiKey: 'key'
    });

    await expect(provider.complete({
      model: model('openai_responses'),
      messages: [createUserMessage('user_input', 'hello')],
      options: { max_tokens: 128 }
    })).resolves.toEqual({
      content: 'hi',
      usage: { total_tokens: 12 }
    });
    expect(requests).toEqual([
      {
        model: 'gpt-5',
        input: [{ role: 'user', content: 'hello' }],
        max_output_tokens: 128
      }
    ]);
  });

  test('streams OpenAI Responses text, reasoning, usage, and finish events', async () => {
    const openAi: OpenAiClientPort = {
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
        return streamFrom([
          { type: 'response.output_text.delta', delta: 'hi' },
          { type: 'response.reasoning_text.delta', delta: 'thinking' },
          { type: 'response.completed', response: { usage: { total_tokens: 14 } } }
        ]);
      }
    };
    const factory = createSdkProviderFactory({
      openAiClientFactory: () => openAi
    });
    const provider = factory({
      provider: 'openai',
      apiProtocol: 'openai_responses',
      apiKey: 'key'
    });
    const events: string[] = [];

    await provider.stream({
      model: model('openai_responses'),
      messages: [createUserMessage('user_input', 'hello')]
    }, {
      onContent: (content) => {
        events.push(`content:${typeof content === 'string' ? content : JSON.stringify(content)}`);
      },
      onThought: (thought) => events.push(`thought:${thought}`),
      onUsage: (usage) => events.push(`usage:${JSON.stringify(usage)}`),
      onFinish: (reason) => events.push(`finish:${reason}`)
    });

    expect(events).toEqual([
      'content:hi',
      'thought:thinking',
      'finish:stop',
      'usage:{"total_tokens":14}'
    ]);
  });

});
