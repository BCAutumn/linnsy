import { createUserMessage } from '@linnlabs/linnkit/contracts';
import { describe, expect, test, vi } from 'vitest';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../shared/errors.js';
import { createLinnsyAiEngineBridge } from '../ai-engine.js';
import type {
  LinnsyLlmProvider,
  LinnsyProviderRouter
} from '../../../domains/llm/features/provider-routing/provider-router.js';
import type { LinnsyModelConfig, LinnsyModelRegistryPort } from '../../../domains/llm/features/model-registry/model-registry.js';

describe('createLinnsyAiEngineBridge', () => {
  test('routes non-streaming calls through the configured provider without leaking registry details', async () => {
    const calls: string[] = [];
    const provider: LinnsyLlmProvider = {
      complete(request) {
        calls.push(`${request.model.id}:${request.model.modelName}`);
        return Promise.resolve({ content: 'hello' });
      },
      stream() {
        return Promise.resolve();
      }
    };
    const engine = createLinnsyAiEngineBridge({
      registry: createRegistry(testModel()),
      router: createStaticRouter(provider)
    });

    await expect(engine.chatCompletion('openai.gpt5', [createUserMessage('user_input', 'hi')])).resolves.toEqual({
      content: 'hello'
    });
    expect(calls).toEqual(['openai.gpt5:gpt-5']);
  });

  test('routes stream callbacks and reports unknown model ids as typed errors', async () => {
    const chunks: string[] = [];
    const provider: LinnsyLlmProvider = {
      complete() {
        return Promise.resolve({});
      },
      stream(request, callbacks) {
        callbacks.onThought?.(`model:${request.model.modelName}`);
        callbacks.onContent?.('chunk');
        callbacks.onUsage?.({ total_tokens: 3 });
        callbacks.onFinish?.('stop');
        return Promise.resolve();
      }
    };
    const engine = createLinnsyAiEngineBridge({
      registry: createRegistry(testModel()),
      router: createStaticRouter(provider)
    });

    await engine.chatCompletionStream(
      'openai.gpt5',
      [createUserMessage('user_input', 'hi')],
      undefined,
      (content) => chunks.push(typeof content === 'string' ? content : JSON.stringify(content)),
      undefined,
      (reason) => chunks.push(`finish:${reason}`),
      (thought) => chunks.push(`thought:${thought}`),
      (usage) => chunks.push(`usage:${JSON.stringify(usage)}`)
    );

    expect(chunks).toEqual([
      'thought:model:gpt-5',
      'chunk',
      'usage:{"total_tokens":3}',
      'finish:stop'
    ]);
    await expect(engine.chatCompletion('missing.model', [])).rejects.toMatchObject({
      code: 'LINNSY_LLM_MODEL_NOT_FOUND',
      recoverable: false
    });
  });

  test('retries a recoverable failure on the same model before falling back', async () => {
    const calls: string[] = [];
    const provider: LinnsyLlmProvider = {
      complete(request) {
        calls.push(request.model.id);
        if (request.model.id === 'openai.primary' && calls.length < 3) {
          return Promise.reject(new LinnsyError(
            LINNSY_ERROR_CODES.LLM_PROVIDER_UNAVAILABLE,
            'temporary provider outage',
            true
          ));
        }
        return Promise.resolve({ content: 'primary answer' });
      },
      stream() {
        return Promise.resolve();
      }
    };
    const primary = testModel('openai.primary', 'gpt-5', ['openai.backup']);
    const fallback = testModel('openai.backup', 'gpt-5-mini');
    const engine = createLinnsyAiEngineBridge({
      registry: createRegistry(primary, fallback),
      router: createStaticRouter(provider)
    });

    vi.useFakeTimers();
    try {
      const completion = engine.chatCompletion('openai.primary', [createUserMessage('user_input', 'hi')]);
      await vi.runAllTimersAsync();

      await expect(completion).resolves.toEqual({ content: 'primary answer' });
      expect(calls).toEqual(['openai.primary', 'openai.primary', 'openai.primary']);
    } finally {
      vi.useRealTimers();
    }
  });

  test('falls back after exhausting all retry attempts for the current model', async () => {
    const calls: string[] = [];
    const provider: LinnsyLlmProvider = {
      complete(request) {
        calls.push(request.model.id);
        if (request.model.id === 'openai.primary') {
          return Promise.reject(new LinnsyError(
            LINNSY_ERROR_CODES.LLM_PROVIDER_UNAVAILABLE,
            'temporary provider outage',
            true
          ));
        }
        return Promise.resolve({ content: 'fallback answer' });
      },
      stream() {
        return Promise.resolve();
      }
    };
    const engine = createLinnsyAiEngineBridge({
      registry: createRegistry(
        testModel('openai.primary', 'gpt-5', ['openai.backup']),
        testModel('openai.backup', 'gpt-5-mini')
      ),
      router: createStaticRouter(provider)
    });

    vi.useFakeTimers();
    try {
      const completion = engine.chatCompletion('openai.primary', [createUserMessage('user_input', 'hi')]);
      await vi.runAllTimersAsync();

      await expect(completion).resolves.toEqual({ content: 'fallback answer' });
      expect(calls).toEqual([
        'openai.primary',
        'openai.primary',
        'openai.primary',
        'openai.primary',
        'openai.primary',
        'openai.primary',
        'openai.backup'
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  test('does not retry or fall back for non-recoverable provider errors', async () => {
    const calls: string[] = [];
    const provider: LinnsyLlmProvider = {
      complete(request) {
        calls.push(request.model.id);
        return Promise.reject(new LinnsyError(
          LINNSY_ERROR_CODES.LLM_PROVIDER_AUTH_MISSING,
          'bad key',
          false
        ));
      },
      stream() {
        return Promise.resolve();
      }
    };
    const engine = createLinnsyAiEngineBridge({
      registry: createRegistry(
        testModel('openai.primary', 'gpt-5', ['openai.backup']),
        testModel('openai.backup', 'gpt-5-mini')
      ),
      router: createStaticRouter(provider)
    });

    await expect(engine.chatCompletion('openai.primary', [createUserMessage('user_input', 'hi')])).rejects.toMatchObject({
      code: LINNSY_ERROR_CODES.LLM_PROVIDER_AUTH_MISSING,
      recoverable: false
    });
    expect(calls).toEqual(['openai.primary']);
  });

  test('does not retry after the owner cancels the provider call', async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    const provider: LinnsyLlmProvider = {
      complete(request) {
        calls.push(request.model.id);
        return Promise.reject(new LinnsyError(
          LINNSY_ERROR_CODES.LLM_PROVIDER_UNAVAILABLE,
          'temporary provider outage',
          true
        ));
      },
      stream() {
        return Promise.resolve();
      }
    };
    const engine = createLinnsyAiEngineBridge({
      registry: createRegistry(
        testModel('openai.primary', 'gpt-5', ['openai.backup']),
        testModel('openai.backup', 'gpt-5-mini')
      ),
      router: createStaticRouter(provider)
    });

    controller.abort();

    await expect(engine.chatCompletion(
      'openai.primary',
      [createUserMessage('user_input', 'hi')],
      { signal: controller.signal }
    )).rejects.toMatchObject({
      code: LINNSY_ERROR_CODES.LLM_PROVIDER_UNAVAILABLE,
      recoverable: true
    });
    expect(calls).toEqual(['openai.primary']);
  });

  test('retries streaming calls before emitting fallback content', async () => {
    const calls: string[] = [];
    const chunks: string[] = [];
    const provider: LinnsyLlmProvider = {
      complete() {
        return Promise.resolve({});
      },
      stream(request, callbacks) {
        calls.push(request.model.id);
        if (request.model.id === 'openai.primary' && calls.length < 3) {
          return Promise.reject(new LinnsyError(
            LINNSY_ERROR_CODES.LLM_PROVIDER_UNAVAILABLE,
            'temporary provider outage',
            true
          ));
        }
        callbacks.onContent?.('primary chunk');
        callbacks.onFinish?.('stop');
        return Promise.resolve();
      }
    };
    const engine = createLinnsyAiEngineBridge({
      registry: createRegistry(
        testModel('openai.primary', 'gpt-5', ['openai.backup']),
        testModel('openai.backup', 'gpt-5-mini')
      ),
      router: createStaticRouter(provider)
    });

    vi.useFakeTimers();
    try {
      const stream = engine.chatCompletionStream(
        'openai.primary',
        [createUserMessage('user_input', 'hi')],
        undefined,
        (content) => chunks.push(typeof content === 'string' ? content : JSON.stringify(content)),
        undefined,
        (reason) => chunks.push(`finish:${reason}`)
      );
      await vi.runAllTimersAsync();

      await stream;
      expect(calls).toEqual(['openai.primary', 'openai.primary', 'openai.primary']);
      expect(chunks).toEqual(['primary chunk', 'finish:stop']);
    } finally {
      vi.useRealTimers();
    }
  });

  test('does not retry streaming calls after output has been emitted', async () => {
    const calls: string[] = [];
    const chunks: string[] = [];
    const provider: LinnsyLlmProvider = {
      complete() {
        return Promise.resolve({});
      },
      stream(request, callbacks) {
        calls.push(request.model.id);
        callbacks.onContent?.('partial chunk');
        return Promise.reject(new LinnsyError(
          LINNSY_ERROR_CODES.LLM_PROVIDER_UNAVAILABLE,
          'stream interrupted',
          true
        ));
      }
    };
    const engine = createLinnsyAiEngineBridge({
      registry: createRegistry(
        testModel('openai.primary', 'gpt-5', ['openai.backup']),
        testModel('openai.backup', 'gpt-5-mini')
      ),
      router: createStaticRouter(provider)
    });

    await expect(engine.chatCompletionStream(
      'openai.primary',
      [createUserMessage('user_input', 'hi')],
      undefined,
      (content) => chunks.push(typeof content === 'string' ? content : JSON.stringify(content))
    )).rejects.toMatchObject({
      code: LINNSY_ERROR_CODES.LLM_PROVIDER_UNAVAILABLE,
      recoverable: true
    });
    expect(calls).toEqual(['openai.primary']);
    expect(chunks).toEqual(['partial chunk']);
  });
});

function createStaticRouter(provider: LinnsyLlmProvider): LinnsyProviderRouter {
  return {
    resolve() {
      return provider;
    }
  };
}

function createRegistry(...models: LinnsyModelConfig[]): LinnsyModelRegistryPort {
  return {
    getModel(modelId: string) {
      return models.find((model) => model.id === modelId) ?? null;
    },
    getDefaultModel() {
      const model = models[0];
      if (model === undefined) {
        throw new Error('expected at least one model');
      }
      return model;
    },
    listModels() {
      return models;
    },
    getRuntimeModelSettings() {
      return { userModels: [], chatModelId: null };
    },
    setRuntimeModelSettings() {
      return undefined;
    }
  };
}

function testModel(
  id = 'openai.gpt5',
  modelName = 'gpt-5',
  fallbackChain?: string[]
): LinnsyModelConfig {
  return {
    id,
    provider: 'openai',
    modelName,
    apiProtocol: 'openai_responses',
    apiKeyEnv: 'LINNSY_OPENAI_KEY',
    ...(fallbackChain === undefined ? {} : { fallbackChain })
  };
}
