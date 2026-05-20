import { describe, expect, test } from 'vitest';

import {
  LINNSY_ERROR_CODES,
  LinnsyError,
  createSdkProviderFactory,
  createUserMessage,
  emptyStream,
  model
} from './scenarios/sdk-provider-factory-support.js';
import type { AnthropicClientPort, OpenAiClientPort } from './scenarios/sdk-provider-factory-support.js';

describe('createSdkProviderFactory error normalization', () => {
  test('wraps provider failures in normalized recoverable LLM errors', async () => {
    const openAi: OpenAiClientPort = {
      createChatCompletion() {
        return Promise.reject(Object.assign(new Error('rate limited'), { status: 429 }));
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
    const factory = createSdkProviderFactory({
      openAiClientFactory: () => openAi
    });
    const provider = factory({
      provider: 'openai',
      apiProtocol: 'openai_chat',
      apiKey: 'key'
    });

    await expect(provider.complete({
      model: model('openai_chat'),
      messages: [createUserMessage('user_input', 'hello')]
    })).rejects.toMatchObject({
      name: 'LinnsyError',
      code: LINNSY_ERROR_CODES.LLM_PROVIDER_UNAVAILABLE,
      recoverable: true
    });
  });

  test('normalizes SDK connection failures without HTTP status as recoverable unavailable errors', async () => {
    const connectionError = Object.assign(new Error('fetch failed'), {
      name: 'APIConnectionError',
      code: 'ECONNRESET'
    });
    const openAi: OpenAiClientPort = {
      createChatCompletion() {
        return Promise.reject(connectionError);
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
    const factory = createSdkProviderFactory({
      openAiClientFactory: () => openAi
    });
    const provider = factory({
      provider: 'openai',
      apiProtocol: 'openai_chat',
      apiKey: 'key'
    });

    await expect(provider.complete({
      model: model('openai_chat'),
      messages: [createUserMessage('user_input', 'hello')]
    })).rejects.toMatchObject({
      name: 'LinnsyError',
      code: LINNSY_ERROR_CODES.LLM_PROVIDER_UNAVAILABLE,
      recoverable: true
    });
  });

  test('keeps authentication failures non-recoverable', async () => {
    const openAi: OpenAiClientPort = {
      createChatCompletion() {
        return Promise.reject(Object.assign(new Error('unauthorized'), { status: 401 }));
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
    const factory = createSdkProviderFactory({
      openAiClientFactory: () => openAi
    });
    const provider = factory({
      provider: 'openai',
      apiProtocol: 'openai_chat',
      apiKey: 'key'
    });

    await expect(provider.complete({
      model: model('openai_chat'),
      messages: [createUserMessage('user_input', 'hello')]
    })).rejects.toMatchObject({
      name: 'LinnsyError',
      code: LINNSY_ERROR_CODES.LLM_PROVIDER_AUTH_MISSING,
      recoverable: false
    });
  });

  test('rejects malformed Anthropic response blocks as codec errors', async () => {
    const anthropic: AnthropicClientPort = {
      createMessage() {
        return Promise.resolve({
          content: [{ type: 'tool_use', id: 'toolu_1', input: { query: 'water' } }]
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
    })).rejects.toBeInstanceOf(LinnsyError);
    await expect(provider.complete({
      model: {
        id: 'anthropic.sonnet',
        provider: 'anthropic',
        modelName: 'claude-sonnet',
        apiProtocol: 'anthropic_messages',
        apiKeyEnv: 'LINNSY_ANTHROPIC_KEY'
      },
      messages: [createUserMessage('user_input', 'hello')]
    })).rejects.toMatchObject({
      code: LINNSY_ERROR_CODES.LLM_CODEC_INVALID_PAYLOAD,
      recoverable: false
    });
  });

});
