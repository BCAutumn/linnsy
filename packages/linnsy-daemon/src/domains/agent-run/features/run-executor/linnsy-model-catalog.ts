import type {
  ModelCatalogEntry,
  ModelCatalogLike
} from '@linnlabs/linnkit/runtime-kernel';

import type { LinnsyModelRegistryPort } from '../../../llm/features/model-registry/model-registry.js';

export function createLinnsyModelCatalog(registry: LinnsyModelRegistryPort): ModelCatalogLike {
  return {
    getModelById(id): ModelCatalogEntry | undefined {
      const model = registry.getModel(id);
      if (model === null) {
        return undefined;
      }
      return {
        id: model.id,
        enabled: true,
        provider: model.provider,
        model_name: model.modelName,
        billing_mode: 'byok',
        enable_client_retry: false,
        capabilities: ['chat'],
        ui_visibility: ['chat'],
        ...(model.baseUrl === undefined ? {} : { api_base: model.baseUrl })
      };
    },
    getModelsByCapability(capability): ModelCatalogEntry[] {
      const defaultModel = registry.getDefaultModel('secretary');
      if (capability !== 'chat') {
        return [];
      }
      const entry = this.getModelById(defaultModel.id);
      return entry === undefined ? [] : [entry];
    },
    getModelsByUIVisibility(visibility): ModelCatalogEntry[] {
      if (visibility !== 'chat') {
        return [];
      }
      const entry = this.getModelById(registry.getDefaultModel('secretary').id);
      return entry === undefined ? [] : [entry];
    }
  };
}

export function createLinnsyModelResolver(registry: LinnsyModelRegistryPort, catalog: ModelCatalogLike): {
  resolveModelId(requestedModelId?: string): string;
  pickFallbackChatModel(excludedModelIds: Set<string>): string | null;
} {
  return {
    resolveModelId(requestedModelId?: string): string {
      return requestedModelId ?? registry.getDefaultModel('secretary').id;
    },
    pickFallbackChatModel(excludedModelIds: Set<string>): string | null {
      for (const model of catalog.getModelsByCapability('chat')) {
        if (!excludedModelIds.has(model.id)) {
          return model.id;
        }
      }
      return null;
    }
  };
}

export function resolveDefinitionModelId(registry: LinnsyModelRegistryPort, configuredModelId: string): string {
  if (configuredModelId === 'default') {
    return registry.getDefaultModel('secretary').id;
  }
  if (configuredModelId === 'cron_summary') {
    return registry.getDefaultModel('cron_summary').id;
  }
  if (configuredModelId === 'memory_consolidate') {
    return registry.getDefaultModel('memory_consolidate').id;
  }
  return configuredModelId;
}
