import { createUserMessage } from '@linnlabs/linnkit/contracts';
import { describe, expect, test } from 'vitest';

import { createProviderRouter, type ProviderFactory } from '../provider-router.js';
import type { LinnsyModelConfig } from '../../model-registry/model-registry.js';

describe('createProviderRouter', () => {
  test('creates providers lazily and reuses them by provider/protocol/base url/key env', async () => {
    const created: string[] = [];
    const factory: ProviderFactory = (config) => {
      created.push(`${config.provider}:${config.apiProtocol}:${config.baseUrl ?? 'default'}`);
      return {
        complete(request) {
          return Promise.resolve({ content: request.model.modelName });
        },
        stream() {
          return Promise.resolve();
        }
      };
    };
    const router = createProviderRouter({ env: { LINNSY_OPENAI_KEY: 'test-key' }, factory });
    const first = openAiModel('openai.gpt5', 'gpt-5');
    const second = openAiModel('openai.gpt5mini', 'gpt-5-mini');

    await router.resolve(first).complete({
      model: first,
      messages: [createUserMessage('user_input', 'hi')]
    });
    await router.resolve(second).complete({
      model: second,
      messages: [createUserMessage('user_input', 'hi')]
    });

    expect(created).toEqual(['openai:openai_responses:https://api.openai.test/v1']);
  });

  test('fails before network calls when the provider api key env is missing', () => {
    const router = createProviderRouter({
      env: {},
      factory() {
        throw new Error('factory should not run');
      }
    });

    expect(() => router.resolve(openAiModel('openai.gpt5', 'gpt-5'))).toThrow(
      'Missing env LINNSY_OPENAI_KEY for provider openai'
    );
  });

  test('uses stored user model api keys without requiring env variables', async () => {
    const seenKeys: string[] = [];
    const router = createProviderRouter({
      env: {},
      factory(config) {
        seenKeys.push(config.apiKey);
        return {
          complete() {
            return Promise.resolve({ ok: true });
          },
          stream() {
            return Promise.resolve();
          }
        };
      }
    });
    const model: LinnsyModelConfig = {
      id: 'user.deepseek',
      provider: 'user_openai_compatible_deepseek',
      modelName: 'deepseek-chat',
      apiProtocol: 'openai_chat',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-local'
    };

    await router.resolve(model).complete({
      model,
      messages: [createUserMessage('user_input', 'hi')]
    });

    expect(seenKeys).toEqual(['sk-local']);
  });

  test('routes user OpenAI-compatible DeepSeek models through the DeepSeek adapter', async () => {
    const created: string[] = [];
    const router = createProviderRouter({
      env: {},
      factory(config) {
        created.push(`${config.provider}:${config.apiProtocol}:${config.baseUrl ?? 'default'}`);
        return {
          complete() {
            return Promise.resolve({ ok: true });
          },
          stream() {
            return Promise.resolve();
          }
        };
      }
    });
    const model: LinnsyModelConfig = {
      id: 'user.bb3e2c8c8c5f',
      provider: 'user_openai_compatible_bb3e2c8c8c5f',
      modelName: 'deepseek-v4-pro',
      apiProtocol: 'openai_chat',
      baseUrl: 'https://proxy.example.test/v1',
      apiKey: 'sk-local'
    };

    await router.resolve(model).complete({
      model,
      messages: [createUserMessage('user_input', 'hi')]
    });

    expect(created).toEqual(['deepseek:openai_chat:https://proxy.example.test/v1']);
  });
});

function openAiModel(id: string, modelName: string): LinnsyModelConfig {
  return {
    id,
    provider: 'openai',
    modelName,
    apiProtocol: 'openai_responses',
    baseUrl: 'https://api.openai.test/v1',
    apiKeyEnv: 'LINNSY_OPENAI_KEY'
  };
}
