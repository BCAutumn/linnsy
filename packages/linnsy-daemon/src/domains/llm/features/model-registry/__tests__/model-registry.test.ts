import { describe, expect, test } from 'vitest';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../shared/errors.js';
import { createModelRegistry } from '../model-registry.js';
import type { LinnsyConfig } from '../../../../../config/schema.js';

describe('createModelRegistry', () => {
  test('resolves default model ids into provider model config', () => {
    const registry = createModelRegistry(createConfig());

    expect(registry.getDefaultModel('secretary')).toMatchObject({
      id: 'openai.gpt5',
      provider: 'openai',
      modelName: 'gpt-5',
      apiProtocol: 'openai_responses',
      apiKeyEnv: 'LINNSY_OPENAI_KEY'
    });
  });

  test('returns null for unknown model ids', () => {
    const registry = createModelRegistry(createConfig());

    expect(registry.getModel('missing.model')).toBeNull();
    expect(registry.getModel('malformed')).toBeNull();
  });

  test('preserves optional provider and reasoning fields when present', () => {
    const registry = createModelRegistry(createConfig());

    expect(registry.getDefaultModel('cron_summary')).toMatchObject({
      id: 'anthropic.sonnet',
      provider: 'anthropic',
      modelName: 'claude-sonnet-4-5-20250929',
      apiProtocol: 'anthropic_messages',
      baseUrl: 'https://api.anthropic.com',
      reasoning: {
        enabled: true,
        budgetTokens: 4096
      },
      fallbackChain: ['openai.gpt5-mini']
    });
  });

  test('projects capabilities, request defaults, and provider options into camelCase', () => {
    const config = createConfig();
    const openaiProvider = config.llm.providers.openai;
    if (openaiProvider === undefined) {
      throw new Error('test config must define openai provider');
    }
    openaiProvider.models.gpt5 = {
      model_name: 'gpt-5',
      capabilities: {
        context_window_tokens: 200000,
        max_output_tokens: 8192,
        modalities: ['text', 'image'],
        supports_tools: true,
        supports_streaming: true,
        supports_reasoning: true
      },
      request_defaults: {
        temperature: 0.3,
        top_p: 0.9,
        max_tokens: 4096
      },
      provider_options: {
        openai: {
          reasoning_summary: 'concise',
          text_verbosity: 'medium',
          request_extra_body: {
            thinking: { type: 'enabled' },
            reasoning_effort: 'high'
          }
        }
      }
    };
    const registry = createModelRegistry(config);

    expect(registry.getModel('openai.gpt5')).toMatchObject({
      capabilities: {
        contextWindowTokens: 200000,
        maxOutputTokens: 8192,
        modalities: ['text', 'image'],
        supportsTools: true,
        supportsStreaming: true,
        supportsReasoning: true
      },
      requestDefaults: {
        temperature: 0.3,
        topP: 0.9,
        maxTokens: 4096
      },
      providerOptions: {
        openai: {
          reasoningSummary: 'concise',
          textVerbosity: 'medium',
          requestExtraBody: {
            thinking: { type: 'enabled' },
            reasoning_effort: 'high'
          }
        }
      }
    });
  });

  test('lets runtime model settings add and select a user chat model', () => {
    const registry = createModelRegistry(createConfig(), {
      chatModelId: 'user.deepseek',
      userModels: [{
        id: 'deepseek',
        providerType: 'openai_compatible',
        baseUrl: 'https://api.deepseek.com/v1',
        modelName: 'deepseek-chat',
        apiKey: 'sk-test',
        displayName: 'DeepSeek'
      }]
    });

    expect(registry.getDefaultModel('secretary')).toMatchObject({
      id: 'user.deepseek',
      provider: 'user_openai_compatible_deepseek',
      modelName: 'deepseek-chat',
      displayName: 'DeepSeek',
      apiProtocol: 'openai_chat',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test'
    });
    expect(registry.listModels().map((model) => model.id)).toContain('user.deepseek');
  });

  test('keeps non-chat defaults on config models when chat model is overridden', () => {
    const registry = createModelRegistry(createConfig(), {
      chatModelId: 'user.claude_proxy',
      userModels: [{
        id: 'claude_proxy',
        providerType: 'anthropic_compatible',
        baseUrl: 'https://api.anthropic.com/v1',
        modelName: 'claude-sonnet-4-5-20250929',
        apiKey: 'sk-ant-test'
      }]
    });

    expect(registry.getDefaultModel('cron_summary').id).toBe('anthropic.sonnet');
    expect(registry.getDefaultModel('secretary')).toMatchObject({
      id: 'user.claude_proxy',
      apiProtocol: 'anthropic_messages',
      apiKey: 'sk-ant-test'
    });
  });

  test('throws a model-not-found error when default points to a missing model', () => {
    const config = createConfig();
    config.llm.defaults.secretary = 'openai.missing';
    const registry = createModelRegistry(config);

    try {
      registry.getDefaultModel('secretary');
      throw new Error('Expected getDefaultModel to throw');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(LinnsyError);
      expect(error).toMatchObject({
        code: LINNSY_ERROR_CODES.LLM_MODEL_NOT_FOUND,
        message: 'Default model secretary points to missing model openai.missing'
      });
    }
  });
});

function createConfig(): LinnsyConfig {
  return {
    profile: 'test',
    home: '/tmp/linnsy-test',
    llm: {
      default_provider: 'openai',
      defaults: {
        secretary: 'openai.gpt5',
        cron_summary: 'anthropic.sonnet',
        memory_consolidate: 'openai.gpt5-mini'
      },
      providers: {
        openai: {
          api_protocol: 'openai_responses',
          api_key_env: 'LINNSY_OPENAI_KEY',
          models: {
            gpt5: {
              model_name: 'gpt-5'
            },
            'gpt5-mini': {
              model_name: 'gpt-5-mini'
            }
          }
        },
        anthropic: {
          api_protocol: 'anthropic_messages',
          base_url: 'https://api.anthropic.com',
          api_key_env: 'LINNSY_ANTHROPIC_KEY',
          models: {
            sonnet: {
              model_name: 'claude-sonnet-4-5-20250929',
              reasoning: {
                enabled: true,
                budget_tokens: 4096
              },
              fallback_chain: ['openai.gpt5-mini']
            }
          }
        }
      }
    },
    channels: {
      cli: { enabled: true },
      web: { enabled: false, bind: '127.0.0.1:7700', bearer_env: 'LINNSY_WEB_BEARER' }
    },
    auth: {
      global_all: false,
      pairing: { code_ttl_ms: 600000, max_attempts: 5 }
    },
    cron: { tick_interval_ms: 60000, default_miss_grace_ms: 7200000 },
    memory: { on_pre_compress_provider: 'builtin' },
    mcp: { server: { enabled: true, transport: 'stdio' }, clients: [] }
  };
}
