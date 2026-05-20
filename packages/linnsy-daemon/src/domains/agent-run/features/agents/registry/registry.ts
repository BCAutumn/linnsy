import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../shared/errors.js';
import type { AgentDefinition } from '../contracts.js';
import { createBuiltInAgentDefinitions, LINNSY_MAIN_AGENT_ID } from '../index.js';

import { createDefaultExternalAgentDefinitions } from './external-definitions.js';
import type { LinnsyAgentRegistryPort } from './types.js';

export interface CreateLinnsyAgentRegistryOptions {
  /** Definitions registered at boot. Order is preserved for `listAgents()`. */
  definitions?: AgentDefinition[];
  /** Override the default agent id; defaults to `linnsy_main`. */
  defaultAgentId?: string;
  /**
   * Inject a default `linnsy_main` definition when callers do not provide one.
   * Disable to assert that callers must supply the main definition explicitly.
   * Default: `true`.
   */
  autoRegisterMain?: boolean;
}

export function createLinnsyAgentRegistry(
  options: CreateLinnsyAgentRegistryOptions = {}
): LinnsyAgentRegistryPort {
  const autoRegisterMain = options.autoRegisterMain ?? true;
  const provided = options.definitions ?? [];
  const definitions = freezeDefinitions(provided, autoRegisterMain, provided.length === 0);
  const byId = indexById(definitions);
  const defaultAgentId = options.defaultAgentId ?? LINNSY_MAIN_AGENT_ID;
  const defaultAgent = byId.get(defaultAgentId);
  if (defaultAgent === undefined) {
    throw new LinnsyError(
      LINNSY_ERROR_CODES.DEFINITION_NOT_FOUND,
      `default agent ${defaultAgentId} is not registered`,
      false
    );
  }
  if (!defaultAgent.enabled) {
    throw new LinnsyError(
      LINNSY_ERROR_CODES.DEFINITION_INVALID,
      `default agent ${defaultAgentId} is disabled`,
      false
    );
  }

  const orderedSnapshot = Object.freeze([...definitions]);

  return {
    getAgent(agentId): AgentDefinition | null {
      return byId.get(agentId) ?? null;
    },
    assertAgent(agentId): AgentDefinition {
      const definition = byId.get(agentId);
      if (definition === undefined) {
        throw new LinnsyError(
          LINNSY_ERROR_CODES.DEFINITION_NOT_FOUND,
          `agent definition ${agentId} is not registered`,
          false
        );
      }
      return definition;
    },
    getDefaultAgent(): AgentDefinition {
      return defaultAgent;
    },
    listAgents(): AgentDefinition[] {
      return [...orderedSnapshot];
    },
    registerAtRuntime(definition): never {
      throw new LinnsyError(
        LINNSY_ERROR_CODES.DEFINITION_REGISTER_AT_RUNTIME,
        `cannot register ${definition.id} after boot; agent topology is frozen in Phase 1`,
        false
      );
    }
  };
}

function freezeDefinitions(
  provided: AgentDefinition[],
  autoRegisterMain: boolean,
  autoRegisterDefaultExternalAgents: boolean
): AgentDefinition[] {
  const seen = new Set<string>();
  const result: AgentDefinition[] = [];
  for (const definition of provided) {
    validateDefinition(definition);
    if (seen.has(definition.id)) {
      throw new LinnsyError(
        LINNSY_ERROR_CODES.DEFINITION_INVALID,
        `duplicate agent definition id ${definition.id}`,
        false
      );
    }
    seen.add(definition.id);
    result.push(deepFreezeDefinition(definition));
  }
  if (autoRegisterMain && !seen.has(LINNSY_MAIN_AGENT_ID)) {
    for (const definition of createBuiltInAgentDefinitions()) {
      if (!seen.has(definition.id)) {
        validateDefinition(definition);
        seen.add(definition.id);
        result.push(deepFreezeDefinition(definition));
      }
    }
  }
  if (autoRegisterMain && autoRegisterDefaultExternalAgents) {
    for (const definition of createDefaultExternalAgentDefinitions()) {
      if (!seen.has(definition.id)) {
        validateDefinition(definition);
        seen.add(definition.id);
        result.push(deepFreezeDefinition(definition));
      }
    }
  }
  return result;
}

function indexById(definitions: AgentDefinition[]): Map<string, AgentDefinition> {
  const map = new Map<string, AgentDefinition>();
  for (const definition of definitions) {
    map.set(definition.id, definition);
  }
  return map;
}

function validateDefinition(definition: AgentDefinition): void {
  if (definition.id.trim().length === 0) {
    throwInvalidDefinition('agent definition id must be non-empty');
  }
  if (definition.displayName.trim().length === 0) {
    throwInvalidDefinition(`agent definition ${definition.id} displayName must be non-empty`);
  }
  if (definition.systemPromptId.trim().length === 0) {
    throwInvalidDefinition(`agent definition ${definition.id} systemPromptId must be non-empty`);
  }
  if (definition.basePrompt.trim().length === 0) {
    throwInvalidDefinition(`agent definition ${definition.id} basePrompt must be non-empty`);
  }
  if (definition.modelPolicy.model.trim().length === 0) {
    throwInvalidDefinition(`agent definition ${definition.id} modelPolicy.model must be non-empty`);
  }
  if (definition.modelPolicy.fallbackChain !== undefined) {
    for (const modelId of definition.modelPolicy.fallbackChain) {
      if (modelId.trim().length === 0) {
        throwInvalidDefinition(`agent definition ${definition.id} fallbackChain contains an empty model id`);
      }
    }
  }
  for (const toolId of definition.toolPolicy.allowedToolIds) {
    if (toolId.trim().length === 0) {
      throwInvalidDefinition(`agent definition ${definition.id} allowedToolIds contains an empty id`);
    }
  }
  for (const toolId of definition.toolPolicy.approvalRequiredToolIds ?? []) {
    if (toolId.trim().length === 0) {
      throwInvalidDefinition(`agent definition ${definition.id} approvalRequiredToolIds contains an empty id`);
    }
  }
  if (definition.executionPolicy?.maxSteps !== undefined) {
    if (!Number.isInteger(definition.executionPolicy.maxSteps) || definition.executionPolicy.maxSteps <= 0) {
      throwInvalidDefinition(`agent definition ${definition.id} executionPolicy.maxSteps must be a positive integer`);
    }
  }
}

function throwInvalidDefinition(message: string): never {
  throw new LinnsyError(LINNSY_ERROR_CODES.DEFINITION_INVALID, message, false);
}

function deepFreezeDefinition(definition: AgentDefinition): AgentDefinition {
  Object.freeze(definition.modelPolicy);
  if (definition.modelPolicy.fallbackChain !== undefined) {
    Object.freeze(definition.modelPolicy.fallbackChain);
  }
  Object.freeze(definition.toolPolicy);
  Object.freeze(definition.toolPolicy.allowedToolIds);
  if (definition.toolPolicy.approvalRequiredToolIds !== undefined) {
    Object.freeze(definition.toolPolicy.approvalRequiredToolIds);
  }
  Object.freeze(definition.memoryPolicy);
  if (definition.contextPolicy !== undefined) {
    deepFreezeUnknown(definition.contextPolicy);
  }
  if (definition.executionPolicy !== undefined) {
    Object.freeze(definition.executionPolicy);
  }
  if (definition.metadata !== undefined) {
    deepFreezeUnknown(definition.metadata);
  }
  return Object.freeze({ ...definition });
}

function deepFreezeUnknown(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreezeUnknown(item);
    }
    Object.freeze(value);
    return;
  }
  if (isObjectRecord(value)) {
    for (const item of Object.values(value)) {
      deepFreezeUnknown(item);
    }
    Object.freeze(value);
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
