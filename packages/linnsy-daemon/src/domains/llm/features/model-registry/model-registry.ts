import type { LinnsyConfig } from '../../../../config/schema.js';
import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../shared/errors.js';
import {
  defaultRuntimeModelSettings,
  fromRuntimeUserModelId,
  toApiProtocol,
  toRuntimeModelId,
  type RuntimeModelSettings
} from '../model-settings/model-settings.js';

export type BuiltInLlmApiProtocol = 'openai_chat' | 'openai_responses' | 'anthropic_messages';
export type LlmApiProtocol = BuiltInLlmApiProtocol | (string & {});

export interface LinnsyReasoningConfig {
  enabled?: boolean;
  effort?: 'minimal' | 'low' | 'medium' | 'high';
  budgetTokens?: number;
}

export type LinnsyModelModality = 'text' | 'image' | 'audio';

export interface LinnsyModelCapabilities {
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  modalities?: LinnsyModelModality[];
  supportsTools?: boolean;
  supportsStreaming?: boolean;
  supportsReasoning?: boolean;
}

export interface LinnsyModelRequestDefaults {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}

export interface LinnsyOpenAiProviderOptions {
  reasoningSummary?: 'auto' | 'concise' | 'detailed';
  textVerbosity?: 'low' | 'medium' | 'high';
  /**
   * Provider-native passthrough body fields merged into the OpenAI chat
   * completions body before the codec-known fields. Use this for
   * OpenAI-compatible endpoints whose request shape extends the standard
   * schema (e.g. DeepSeek `thinking` + `reasoning_effort`). Codec-known
   * fields (model/messages/temperature/top_p/max_tokens/tools/tool_choice)
   * always override entries from this map.
   */
  requestExtraBody?: Record<string, unknown>;
}

export interface LinnsyAnthropicProviderOptions {
  thinkingBudgetTokens?: number;
}

export interface LinnsyModelProviderOptions {
  openai?: LinnsyOpenAiProviderOptions;
  anthropic?: LinnsyAnthropicProviderOptions;
}

export interface LinnsyModelConfig {
  id: string;
  provider: string;
  modelName: string;
  apiProtocol: LlmApiProtocol;
  baseUrl?: string;
  apiKeyEnv?: string;
  apiKey?: string;
  capabilities?: LinnsyModelCapabilities;
  reasoning?: LinnsyReasoningConfig;
  requestDefaults?: LinnsyModelRequestDefaults;
  providerOptions?: LinnsyModelProviderOptions;
  fallbackChain?: string[];
  displayName?: string;
}

export interface LinnsyModelRegistryPort {
  getModel(modelId: string): LinnsyModelConfig | null;
  getDefaultModel(kind: 'secretary' | 'cron_summary' | 'memory_consolidate'): LinnsyModelConfig;
  listModels(): LinnsyModelConfig[];
  getRuntimeModelSettings(): RuntimeModelSettings;
  setRuntimeModelSettings(settings: RuntimeModelSettings): void;
}

export function createModelRegistry(
  config: LinnsyConfig,
  initialSettings: RuntimeModelSettings = defaultRuntimeModelSettings
): LinnsyModelRegistryPort {
  let runtimeSettings = cloneRuntimeModelSettings(initialSettings);

  return {
    getModel(modelId: string): LinnsyModelConfig | null {
      return resolveModel(config, runtimeSettings, modelId);
    },
    getDefaultModel(kind: 'secretary' | 'cron_summary' | 'memory_consolidate'): LinnsyModelConfig {
      const firstUserModel = runtimeSettings.userModels[0];
      const configuredModelId = kind === 'secretary' && runtimeSettings.chatModelId !== null
        ? runtimeSettings.chatModelId
        : kind === 'secretary' && firstUserModel !== undefined
          ? toRuntimeModelId(firstUserModel.id)
          : config.llm.defaults[kind];
      const model = resolveModel(config, runtimeSettings, configuredModelId);

      if (model === null) {
        throw new LinnsyError(
          LINNSY_ERROR_CODES.LLM_MODEL_NOT_FOUND,
          `Default model ${kind} points to missing model ${configuredModelId}`,
          false
        );
      }

      return model;
    },
    listModels(): LinnsyModelConfig[] {
      return runtimeSettings.userModels.map(toUserModelConfig);
    },
    getRuntimeModelSettings(): RuntimeModelSettings {
      return cloneRuntimeModelSettings(runtimeSettings);
    },
    setRuntimeModelSettings(settings: RuntimeModelSettings): void {
      runtimeSettings = cloneRuntimeModelSettings(settings);
    }
  };
}

function resolveModel(
  config: LinnsyConfig,
  runtimeSettings: RuntimeModelSettings,
  modelId: string
): LinnsyModelConfig | null {
  const userModelId = fromRuntimeUserModelId(modelId);
  if (userModelId !== null) {
    const userModel = runtimeSettings.userModels.find((model) => model.id === userModelId);
    return userModel === undefined ? null : toUserModelConfig(userModel);
  }

  const separatorIndex = modelId.indexOf('.');
  if (separatorIndex <= 0 || separatorIndex === modelId.length - 1) {
    return null;
  }

  const providerId = modelId.slice(0, separatorIndex);
  const modelKey = modelId.slice(separatorIndex + 1);
  const provider = config.llm.providers[providerId];
  const model = provider?.models[modelKey];

  if (provider === undefined || model === undefined) {
    return null;
  }

  const result: LinnsyModelConfig = {
    id: modelId,
    provider: providerId,
    modelName: model.model_name,
    apiProtocol: provider.api_protocol,
    apiKeyEnv: provider.api_key_env
  };

  if (model.display_name !== undefined) {
    result.displayName = model.display_name;
  }
  if (provider.base_url !== undefined) {
    result.baseUrl = provider.base_url;
  }

  const capabilities = toCapabilities(model.capabilities);
  if (capabilities !== undefined) {
    result.capabilities = capabilities;
  }
  const reasoning = toReasoningConfig(model.reasoning);
  if (reasoning !== undefined) {
    result.reasoning = reasoning;
  }
  const requestDefaults = toRequestDefaults(model.request_defaults);
  if (requestDefaults !== undefined) {
    result.requestDefaults = requestDefaults;
  }
  const providerOptions = toProviderOptions(model.provider_options);
  if (providerOptions !== undefined) {
    result.providerOptions = providerOptions;
  }
  if (model.fallback_chain !== undefined) {
    result.fallbackChain = [...model.fallback_chain];
  }

  return result;
}

function toUserModelConfig(model: RuntimeModelSettings['userModels'][number]): LinnsyModelConfig {
  const config: LinnsyModelConfig = {
    id: toRuntimeModelId(model.id),
    provider: `user_${model.providerType}_${model.id}`,
    modelName: model.modelName,
    apiProtocol: toApiProtocol(model.providerType),
    ...(model.apiKeyEnv === undefined ? {} : { apiKeyEnv: model.apiKeyEnv }),
    ...(model.apiKey === undefined ? {} : { apiKey: model.apiKey }),
    baseUrl: model.baseUrl
  };

  if (model.displayName !== undefined) {
    config.displayName = model.displayName;
  }

  return config;
}

function cloneRuntimeModelSettings(settings: RuntimeModelSettings): RuntimeModelSettings {
  return {
    chatModelId: settings.chatModelId,
    userModels: settings.userModels.map((model) => ({ ...model }))
  };
}

type ModelConfig = LinnsyConfig['llm']['providers'][string]['models'][string];

function toReasoningConfig(reasoning: ModelConfig['reasoning']): LinnsyReasoningConfig | undefined {
  if (reasoning === undefined) {
    return undefined;
  }

  const config: LinnsyReasoningConfig = {};

  if (reasoning.enabled !== undefined) {
    config.enabled = reasoning.enabled;
  }
  if (reasoning.effort !== undefined) {
    config.effort = reasoning.effort;
  }
  if (reasoning.budget_tokens !== undefined) {
    config.budgetTokens = reasoning.budget_tokens;
  }

  return config;
}

function toCapabilities(capabilities: ModelConfig['capabilities']): LinnsyModelCapabilities | undefined {
  if (capabilities === undefined) {
    return undefined;
  }

  const result: LinnsyModelCapabilities = {};
  if (capabilities.context_window_tokens !== undefined) {
    result.contextWindowTokens = capabilities.context_window_tokens;
  }
  if (capabilities.max_output_tokens !== undefined) {
    result.maxOutputTokens = capabilities.max_output_tokens;
  }
  if (capabilities.modalities !== undefined) {
    result.modalities = [...capabilities.modalities];
  }
  if (capabilities.supports_tools !== undefined) {
    result.supportsTools = capabilities.supports_tools;
  }
  if (capabilities.supports_streaming !== undefined) {
    result.supportsStreaming = capabilities.supports_streaming;
  }
  if (capabilities.supports_reasoning !== undefined) {
    result.supportsReasoning = capabilities.supports_reasoning;
  }
  return result;
}

function toRequestDefaults(
  defaults: ModelConfig['request_defaults']
): LinnsyModelRequestDefaults | undefined {
  if (defaults === undefined) {
    return undefined;
  }

  const result: LinnsyModelRequestDefaults = {};
  if (defaults.temperature !== undefined) {
    result.temperature = defaults.temperature;
  }
  if (defaults.top_p !== undefined) {
    result.topP = defaults.top_p;
  }
  if (defaults.max_tokens !== undefined) {
    result.maxTokens = defaults.max_tokens;
  }
  return result;
}

function toProviderOptions(
  providerOptions: ModelConfig['provider_options']
): LinnsyModelProviderOptions | undefined {
  if (providerOptions === undefined) {
    return undefined;
  }

  const result: LinnsyModelProviderOptions = {};
  if (providerOptions.openai !== undefined) {
    const openai: LinnsyOpenAiProviderOptions = {};
    if (providerOptions.openai.reasoning_summary !== undefined) {
      openai.reasoningSummary = providerOptions.openai.reasoning_summary;
    }
    if (providerOptions.openai.text_verbosity !== undefined) {
      openai.textVerbosity = providerOptions.openai.text_verbosity;
    }
    if (providerOptions.openai.request_extra_body !== undefined) {
      openai.requestExtraBody = { ...providerOptions.openai.request_extra_body };
    }
    result.openai = openai;
  }
  if (providerOptions.anthropic !== undefined) {
    const anthropic: LinnsyAnthropicProviderOptions = {};
    if (providerOptions.anthropic.thinking_budget_tokens !== undefined) {
      anthropic.thinkingBudgetTokens = providerOptions.anthropic.thinking_budget_tokens;
    }
    result.anthropic = anthropic;
  }
  return result;
}
