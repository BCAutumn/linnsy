import type { AgentDefinition } from '../contracts.js';

export type {
  AgentDefinition,
  AgentContextPolicy,
  AgentExecutionPolicy,
  AgentMemoryPolicy,
  AgentModelPolicy,
  AgentToolPolicy
} from '../contracts.js';

export interface LinnsyAgentRegistryPort {
  /** Look up an agent definition; returns null when not registered. */
  getAgent(agentId: string): AgentDefinition | null;

  /**
   * Look up an agent definition; throws `LINNSY_DEFINITION_NOT_FOUND` when missing.
   * Caller layers (spawner, prompt assembler) MUST use this when the definition is required.
   */
  assertAgent(agentId: string): AgentDefinition;

  /** Default agent (Phase 1: linnsy_main). */
  getDefaultAgent(): AgentDefinition;

  /** Snapshot of all registered agents in registration order. */
  listAgents(): AgentDefinition[];

  /**
   * Phase 1 contract: registry is frozen at boot.
   * Always throws `LINNSY_DEFINITION_REGISTER_AT_RUNTIME` to keep agent topology static.
   */
  registerAtRuntime(definition: AgentDefinition): never;
}
