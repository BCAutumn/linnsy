import { describe, expect, test } from 'vitest';

import {
  createSdkProviderFactory,
  createUserMessage,
  emptyStream,
  streamFrom
} from './scenarios/sdk-provider-factory-support.js';
import type { AnthropicClientPort } from './scenarios/sdk-provider-factory-support.js';

describe('createSdkProviderFactory Anthropic adapters', () => {
  test('normalizes Anthropic content blocks into linnkit response content', async () => {
    const anthropic: AnthropicClientPort = {
      createMessage() {
        return Promise.resolve({
          content: [
            { type: 'text', text: 'answer' },
            { type: 'thinking', thinking: 'reasoning' },
            { type: 'tool_use', id: 'toolu_1', name: 'recall_memory', input: { query: 'water' } }
          ],
          usage: { input_tokens: 4, output_tokens: 5 }
        });
      },
      streamMessage() {
        return emptyStream();
      }
    };
    const factory = createSdkProviderFactory({
      anthropicClientFactory: () => anthropic
    });
    const provider = factory({
      provider: 'anthropic',
      apiProtocol: 'anthropic_messages',
      apiKey: 'key'
    });

    await expect(provider.complete({
      model: {
        id: 'anthropic.sonnet',
        provider: 'anthropic',
        modelName: 'claude-sonnet',
        apiProtocol: 'anthropic_messages',
        apiKeyEnv: 'LINNSY_ANTHROPIC_KEY'
      },
      messages: [createUserMessage('user_input', 'hello')]
    })).resolves.toEqual({
      content: 'answer',
      tool_calls: [
        {
          id: 'toolu_1',
          type: 'function',
          function: { name: 'recall_memory', arguments: '{"query":"water"}' }
        }
      ],
      reasoning_details: [{ type: 'thinking', thinking: 'reasoning' }],
      usage: { input_tokens: 4, output_tokens: 5 }
    });
  });

  test('streams Anthropic text, thinking, usage, and finish events', async () => {
    const anthropic: AnthropicClientPort = {
      createMessage() {
        return Promise.resolve({});
      },
      streamMessage() {
        return streamFrom([
          { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'plan' } },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } }
        ]);
      }
    };
    const factory = createSdkProviderFactory({
      anthropicClientFactory: () => anthropic
    });
    const provider = factory({
      provider: 'anthropic',
      apiProtocol: 'anthropic_messages',
      apiKey: 'key'
    });
    const events: string[] = [];

    await provider.stream({
      model: {
        id: 'anthropic.sonnet',
        provider: 'anthropic',
        modelName: 'claude-sonnet',
        apiProtocol: 'anthropic_messages',
        apiKeyEnv: 'LINNSY_ANTHROPIC_KEY'
      },
      messages: [createUserMessage('user_input', 'hello')]
    }, {
      onThought: (thought) => events.push(`thought:${thought}`),
      onContent: (content) => {
        if (typeof content === 'string') {
          events.push(`content:${content}`);
        } else {
          events.push(`content:${JSON.stringify(content)}`);
        }
      },
      onUsage: (usage) => events.push(`usage:${JSON.stringify(usage)}`),
      onFinish: (reason) => events.push(`finish:${reason}`)
    });

    expect(events).toEqual([
      'thought:plan',
      'content:hi',
      'usage:{"output_tokens":3}',
      'finish:end_turn'
    ]);
  });

});
