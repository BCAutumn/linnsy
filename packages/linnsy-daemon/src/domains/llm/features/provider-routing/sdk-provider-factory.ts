import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageCreateParamsNonStreaming,
  MessageCreateParamsStreaming
} from '@anthropic-ai/sdk/resources/messages';
import {
  createFenceRegistry,
  type FenceRegistry
} from '@linnlabs/linnkit/context-manager';
import OpenAI from 'openai';
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming
} from 'openai/resources/chat/completions';
import type {
  ResponseCreateParamsNonStreaming,
  ResponseCreateParamsStreaming
} from 'openai/resources/responses/responses';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../shared/errors.js';
import type { buildAnthropicMessagesRequest } from './codecs/anthropic-messages.js';
import {
  createBuiltInProviderAdapterRegistry,
  registerCodecFallbacks,
  registerProviderAdapters
} from './provider-adapters/registry.js';
import { flattenStream } from './provider-adapters/shared.js';
import type {
  AnthropicClientPort,
  CodecRegistry,
  OpenAiClientPort,
  ProviderAdapterRegistration,
  SdkProviderAdapter,
  SdkProviderAdapterDependencies,
  SdkProviderCodec
} from './provider-adapters/types.js';
import type {
  LinnsyProviderFactoryConfig,
  ProviderFactory
} from './provider-router.js';
import type { LlmRequestDebugObserverPort } from '../../shared/llm-request-debug-observer.js';
import { readLlmRequestDebugScope } from '../../shared/llm-request-debug-scope.js';

export type {
  AnthropicClientPort,
  CodecRegistry,
  OpenAiClientPort,
  ProviderAdapterRegistration,
  SdkProviderAdapter,
  SdkProviderAdapterDependencies,
  SdkProviderCodec
};

export interface CreateSdkProviderFactoryOptions {
  openAiClientFactory?: (config: LinnsyProviderFactoryConfig) => OpenAiClientPort;
  anthropicClientFactory?: (config: LinnsyProviderFactoryConfig) => AnthropicClientPort;
  codecRegistry?: CodecRegistry;
  providerAdapters?: readonly ProviderAdapterRegistration[];
  llmRequestDebugObserver?: LlmRequestDebugObserverPort;
  fenceRegistry?: FenceRegistry;
}

export function createSdkProviderFactory(options: CreateSdkProviderFactoryOptions = {}): ProviderFactory {
  const openAiClientFactory = options.openAiClientFactory ?? ((config) => {
    return createOpenAiSdkClient(config, options.llmRequestDebugObserver);
  });
  const anthropicClientFactory = options.anthropicClientFactory ?? ((config) => {
    return createAnthropicSdkClient(config, options.llmRequestDebugObserver);
  });
  const dependencies: SdkProviderAdapterDependencies = {
    openAiClientFactory,
    anthropicClientFactory,
    fenceRegistry: options.fenceRegistry ?? createFenceRegistry([])
  };
  const adapterRegistry = createBuiltInProviderAdapterRegistry();

  registerCodecFallbacks(adapterRegistry, options.codecRegistry);
  registerProviderAdapters(adapterRegistry, options.providerAdapters);

  return (config: LinnsyProviderFactoryConfig) => {
    const adapter = adapterRegistry.resolve(config);
    if (adapter === undefined) {
      throw new LinnsyError(
        LINNSY_ERROR_CODES.LLM_PROTOCOL_UNSUPPORTED,
        `LLM API protocol ${config.apiProtocol} is not supported`,
        false
      );
    }

    return adapter.createProvider(config, dependencies);
  };
}

function createOpenAiSdkClient(
  config: LinnsyProviderFactoryConfig,
  observer: LlmRequestDebugObserverPort | undefined
): OpenAiClientPort {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl
  });

  return {
    async createChatCompletion(request, signal) {
      await observeWireRequest(observer, config, request, false);
      const body = request as ChatCompletionCreateParamsNonStreaming;
      return client.chat.completions.create(body, { signal });
    },
    streamChatCompletion(request, signal) {
      return observeThenStream(observer, config, request, () => {
        const body = { ...request, stream: true } as ChatCompletionCreateParamsStreaming;
        return Promise.resolve(flattenStream(client.chat.completions.create(body, { signal })));
      });
    },
    async createResponse(request, signal) {
      await observeWireRequest(observer, config, request, false);
      const body = request as ResponseCreateParamsNonStreaming;
      return client.responses.create(body, { signal });
    },
    streamResponse(request, signal) {
      return observeThenStream(observer, config, request, () => {
        const body = { ...request, stream: true } as ResponseCreateParamsStreaming;
        return Promise.resolve(flattenStream(client.responses.create(body, { signal })));
      });
    }
  };
}

function createAnthropicSdkClient(
  config: LinnsyProviderFactoryConfig,
  observer: LlmRequestDebugObserverPort | undefined
): AnthropicClientPort {
  const client = new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseUrl
  });

  return {
    async createMessage(request, signal) {
      await observeWireRequest(observer, config, withAnthropicMaxTokens(request), false);
      const body = withAnthropicMaxTokens(request) as MessageCreateParamsNonStreaming;
      return client.messages.create(body, { signal });
    },
    streamMessage(request, signal) {
      return observeThenStream(observer, config, withAnthropicMaxTokens(request), () => {
        const body = { ...withAnthropicMaxTokens(request), stream: true } as MessageCreateParamsStreaming;
        return Promise.resolve(flattenStream(client.messages.create(body, { signal })));
      });
    }
  };
}

function withAnthropicMaxTokens(request: ReturnType<typeof buildAnthropicMessagesRequest>) {
  return {
    ...request,
    max_tokens: request.max_tokens ?? 4096
  };
}

async function observeWireRequest(
  observer: LlmRequestDebugObserverPort | undefined,
  config: LinnsyProviderFactoryConfig,
  request: unknown,
  stream: boolean
): Promise<void> {
  const scope = readLlmRequestDebugScope();
  await observer?.observeWireRequest({
    ...(scope === undefined ? {} : { scope }),
    modelId: readWireModelId(request),
    provider: config.provider,
    apiProtocol: config.apiProtocol,
    stream,
    request
  });
}

async function* observeThenStream<T>(
  observer: LlmRequestDebugObserverPort | undefined,
  config: LinnsyProviderFactoryConfig,
  request: unknown,
  createStream: () => Promise<AsyncIterable<T>>
): AsyncIterable<T> {
  await observeWireRequest(observer, config, request, true);
  const stream = await createStream();
  for await (const event of stream) {
    yield event;
  }
}

function readWireModelId(request: unknown): string {
  if (
    typeof request === 'object' &&
    request !== null &&
    'model' in request &&
    typeof request.model === 'string'
  ) {
    return request.model;
  }
  return 'unknown-model';
}
