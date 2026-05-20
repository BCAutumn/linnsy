import type { AgentAiEngineStreamContent, LlmCallOptions } from '@linnlabs/linnkit/ports';
import type { AiMessage } from '@linnlabs/linnkit/contracts';
import type { FenceRegistry } from '@linnlabs/linnkit/context-manager';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../shared/errors.js';
import type { LinnsyModelConfig } from '../model-registry/model-registry.js';
import { createSdkProviderFactory } from './sdk-provider-factory.js';
import type { LlmRequestDebugObserverPort } from '../../shared/llm-request-debug-observer.js';

export interface LinnsyLlmProviderRequest {
  model: LinnsyModelConfig;
  messages: AiMessage[];
  options?: LlmCallOptions & {
    signal?: AbortSignal;
    stream_options?: {
      include_usage?: boolean;
    };
  };
}

export interface LinnsyStreamCallbacks {
  onContent?: (content: AgentAiEngineStreamContent) => void;
  onError?: (error: Error) => void;
  onFinish?: (reason: string) => void;
  onThought?: (thought: string) => void;
  onUsage?: (usage: unknown) => void;
}

export interface LinnsyLlmProvider {
  complete(request: LinnsyLlmProviderRequest): Promise<unknown>;
  stream(request: LinnsyLlmProviderRequest, callbacks: LinnsyStreamCallbacks): Promise<void>;
  dispose?(): void;
}

export interface LinnsyProviderRouter {
  resolve(model: LinnsyModelConfig): LinnsyLlmProvider;
  dispose?(): void;
}

export type ProviderFactory = (config: LinnsyProviderFactoryConfig) => LinnsyLlmProvider;

export interface LinnsyProviderFactoryConfig {
  provider: string;
  apiProtocol: LinnsyModelConfig['apiProtocol'];
  baseUrl?: string;
  apiKey: string;
}

export interface CreateProviderRouterOptions {
  env?: Record<string, string | undefined>;
  factory?: ProviderFactory;
  llmRequestDebugObserver?: LlmRequestDebugObserverPort;
  fenceRegistry?: FenceRegistry;
}

export function createProviderRouter(options: CreateProviderRouterOptions = {}): LinnsyProviderRouter {
  const env = options.env ?? process.env;
  const factory = options.factory ?? createSdkProviderFactory({
    ...(options.llmRequestDebugObserver === undefined
      ? {}
      : { llmRequestDebugObserver: options.llmRequestDebugObserver }),
    ...(options.fenceRegistry === undefined ? {} : { fenceRegistry: options.fenceRegistry })
  });
  const cache = new Map<string, LinnsyLlmProvider>();

  return {
    resolve(model: LinnsyModelConfig): LinnsyLlmProvider {
      const apiKey = model.apiKey ?? (model.apiKeyEnv === undefined ? undefined : env[model.apiKeyEnv]);
      if (apiKey === undefined || apiKey.length === 0) {
        const source = model.apiKeyEnv === undefined ? 'stored API key' : `env ${model.apiKeyEnv}`;
        throw new LinnsyError(
          LINNSY_ERROR_CODES.LLM_PROVIDER_AUTH_MISSING,
          `Missing ${source} for provider ${model.provider}`,
          false
        );
      }

      const adapterProvider = providerAdapterProvider(model);
      const cacheKey = providerCacheKey(model, adapterProvider);
      const cached = cache.get(cacheKey);
      if (cached !== undefined) {
        return cached;
      }

      const factoryConfig: LinnsyProviderFactoryConfig = {
        provider: adapterProvider,
        apiProtocol: model.apiProtocol,
        apiKey
      };

      if (model.baseUrl !== undefined) {
        factoryConfig.baseUrl = model.baseUrl;
      }

      const provider = factory(factoryConfig);
      cache.set(cacheKey, provider);
      return provider;
    },
    dispose(): void {
      for (const provider of cache.values()) {
        provider.dispose?.();
      }
      cache.clear();
    }
  };
}

function providerAdapterProvider(model: LinnsyModelConfig): string {
  if (shouldUseDeepseekChatAdapter(model)) {
    return 'deepseek';
  }

  return model.provider;
}

function shouldUseDeepseekChatAdapter(model: LinnsyModelConfig): boolean {
  if (model.apiProtocol !== 'openai_chat') {
    return false;
  }
  if (model.provider === 'deepseek') {
    return true;
  }
  if (!model.provider.startsWith('user_openai_compatible_')) {
    return false;
  }

  return includesDeepseek(model.modelName) || includesDeepseek(model.baseUrl);
}

function includesDeepseek(value: string | undefined): boolean {
  return value?.toLowerCase().includes('deepseek') === true;
}

function providerCacheKey(model: LinnsyModelConfig, adapterProvider: string): string {
  return [
    model.provider,
    adapterProvider,
    model.apiProtocol,
    model.baseUrl ?? '',
    model.apiKeyEnv ?? '',
    model.apiKey ?? ''
  ].join('\u001f');
}
