import type { FenceRegistry } from '@linnlabs/linnkit/context-manager';

import type { buildAnthropicMessagesRequest } from '../codecs/anthropic-messages.js';
import type { buildOpenAiChatRequest } from '../codecs/openai-chat.js';
import type { buildOpenAiResponsesRequest } from '../codecs/openai-responses.js';
import type { LlmApiProtocol } from '../../model-registry/model-registry.js';
import type { LinnsyLlmProvider, LinnsyProviderFactoryConfig } from '../provider-router.js';

export interface OpenAiClientPort {
  createChatCompletion(request: ReturnType<typeof buildOpenAiChatRequest>, signal?: AbortSignal): Promise<unknown>;
  streamChatCompletion(
    request: ReturnType<typeof buildOpenAiChatRequest>,
    signal?: AbortSignal
  ): AsyncIterable<unknown>;
  createResponse(request: ReturnType<typeof buildOpenAiResponsesRequest>, signal?: AbortSignal): Promise<unknown>;
  streamResponse(
    request: ReturnType<typeof buildOpenAiResponsesRequest>,
    signal?: AbortSignal
  ): AsyncIterable<unknown>;
}

export interface AnthropicClientPort {
  createMessage(request: ReturnType<typeof buildAnthropicMessagesRequest>, signal?: AbortSignal): Promise<unknown>;
  streamMessage(
    request: ReturnType<typeof buildAnthropicMessagesRequest>,
    signal?: AbortSignal
  ): AsyncIterable<unknown>;
}

export interface SdkProviderAdapterDependencies {
  openAiClientFactory(config: LinnsyProviderFactoryConfig): OpenAiClientPort;
  anthropicClientFactory(config: LinnsyProviderFactoryConfig): AnthropicClientPort;
  fenceRegistry: FenceRegistry;
}

export interface SdkProviderAdapter {
  createProvider(config: LinnsyProviderFactoryConfig, dependencies: SdkProviderAdapterDependencies): LinnsyLlmProvider;
}

export interface ProviderAdapterRegistration {
  provider: string;
  apiProtocol: LlmApiProtocol;
  adapter: SdkProviderAdapter;
}

export type SdkProviderCodec = SdkProviderAdapter;

export type CodecRegistry = Partial<Record<LlmApiProtocol, SdkProviderCodec>>;
