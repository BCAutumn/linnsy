import { describe, expect, test } from 'vitest';

import { createSdkProviderFactory } from './scenarios/sdk-provider-factory-support.js';

describe('createSdkProviderFactory registry adapters', () => {
  test('builds providers from an injected codec registry entry', async () => {
    const factory = createSdkProviderFactory({
      codecRegistry: {
        custom_protocol: {
          createProvider() {
            return {
              complete() {
                return Promise.resolve({ content: 'custom' });
              },
              stream() {
                return Promise.resolve();
              }
            };
          }
        }
      }
    });
    const provider = factory({
      provider: 'custom',
      apiProtocol: 'custom_protocol',
      apiKey: 'key'
    });

    await expect(provider.complete({
      model: {
        id: 'custom.model',
        provider: 'custom',
        modelName: 'model',
        apiProtocol: 'custom_protocol',
        apiKeyEnv: 'CUSTOM_KEY'
      },
      messages: []
    })).resolves.toEqual({ content: 'custom' });
  });

  test('prefers provider-specific adapters over protocol fallback adapters', async () => {
    const factory = createSdkProviderFactory({
      providerAdapters: [
        {
          provider: 'specific',
          apiProtocol: 'openai_chat',
          adapter: {
            createProvider() {
              return {
                complete() {
                  return Promise.resolve({ content: 'specific' });
                },
                stream() {
                  return Promise.resolve();
                }
              };
            }
          }
        }
      ],
      codecRegistry: {
        openai_chat: {
          createProvider() {
            return {
              complete() {
                return Promise.resolve({ content: 'fallback' });
              },
              stream() {
                return Promise.resolve();
              }
            };
          }
        }
      }
    });
    const provider = factory({
      provider: 'specific',
      apiProtocol: 'openai_chat',
      apiKey: 'key'
    });

    await expect(provider.complete({
      model: {
        id: 'specific.model',
        provider: 'specific',
        modelName: 'model',
        apiProtocol: 'openai_chat',
        apiKeyEnv: 'SPECIFIC_KEY'
      },
      messages: []
    })).resolves.toEqual({ content: 'specific' });
  });

});
