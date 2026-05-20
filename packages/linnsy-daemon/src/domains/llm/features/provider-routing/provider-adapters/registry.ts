import { AnthropicMessagesAdapter } from './anthropic-messages-adapter.js';
import { DeepseekChatAdapter } from './deepseek-chat-adapter.js';
import { OpenAiChatAdapter } from './openai-chat-adapter.js';
import { OpenAiResponsesAdapter } from './openai-responses-adapter.js';
import type {
  CodecRegistry,
  ProviderAdapterRegistration,
  SdkProviderAdapter
} from './types.js';
import type { LlmApiProtocol } from '../../model-registry/model-registry.js';
import type { LinnsyProviderFactoryConfig } from '../provider-router.js';

export class ProviderAdapterRegistry {
  private readonly providerAdapters = new Map<string, SdkProviderAdapter>();
  private readonly protocolAdapters = new Map<LlmApiProtocol, SdkProviderAdapter>();

  public registerProvider(provider: string, apiProtocol: LlmApiProtocol, adapter: SdkProviderAdapter): void {
    this.providerAdapters.set(providerAdapterKey(provider, apiProtocol), adapter);
  }

  public registerProtocol(apiProtocol: LlmApiProtocol, adapter: SdkProviderAdapter): void {
    this.protocolAdapters.set(apiProtocol, adapter);
  }

  public resolve(config: LinnsyProviderFactoryConfig): SdkProviderAdapter | undefined {
    return this.providerAdapters.get(providerAdapterKey(config.provider, config.apiProtocol)) ??
      this.protocolAdapters.get(config.apiProtocol);
  }
}

export function createBuiltInProviderAdapterRegistry(): ProviderAdapterRegistry {
  const registry = new ProviderAdapterRegistry();
  const openAiChatAdapter = new OpenAiChatAdapter();

  registry.registerProtocol('openai_chat', openAiChatAdapter);
  registry.registerProvider('deepseek', 'openai_chat', new DeepseekChatAdapter());
  registry.registerProtocol('openai_responses', new OpenAiResponsesAdapter());
  registry.registerProtocol('anthropic_messages', new AnthropicMessagesAdapter());
  return registry;
}

export function registerProviderAdapters(
  registry: ProviderAdapterRegistry,
  registrations: readonly ProviderAdapterRegistration[] | undefined
): void {
  for (const registration of registrations ?? []) {
    registry.registerProvider(registration.provider, registration.apiProtocol, registration.adapter);
  }
}

export function registerCodecFallbacks(registry: ProviderAdapterRegistry, codecRegistry: CodecRegistry | undefined): void {
  for (const [apiProtocol, adapter] of Object.entries(codecRegistry ?? {})) {
    if (adapter !== undefined && isLlmApiProtocol(apiProtocol)) {
      registry.registerProtocol(apiProtocol, adapter);
    }
  }
}

function providerAdapterKey(provider: string, apiProtocol: LlmApiProtocol): string {
  return `${provider}:${apiProtocol}`;
}

function isLlmApiProtocol(value: string): value is LlmApiProtocol {
  return value.length > 0;
}
