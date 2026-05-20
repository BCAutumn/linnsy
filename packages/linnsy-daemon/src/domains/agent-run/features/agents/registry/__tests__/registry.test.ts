import { describe, expect, test } from 'vitest';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../../shared/errors.js';
import {
  createLinnsyMainAgentDefinition,
  LINNSY_MAIN_AGENT_ID
} from '../../index.js';
import { createLinnsyAgentRegistry } from '../registry.js';
import type { AgentDefinition } from '../types.js';

function expectThrows(fn: () => unknown, code: string): void {
  let captured: unknown;
  try {
    fn();
  } catch (error) {
    captured = error;
  }
  expect(captured).toBeInstanceOf(LinnsyError);
  expect((captured as LinnsyError).code).toBe(code);
}

function makeDefinition(overrides: Partial<AgentDefinition> & { id: string }): AgentDefinition {
  return {
    id: overrides.id,
    displayName: overrides.displayName ?? overrides.id,
    description: overrides.description ?? '',
    systemPromptId: overrides.systemPromptId ?? `${overrides.id}.system`,
    basePrompt: overrides.basePrompt ?? `${overrides.id} prompt`,
    modelPolicy: overrides.modelPolicy ?? { model: 'default' },
    toolPolicy: overrides.toolPolicy ?? { allowedToolIds: [] },
    memoryPolicy: overrides.memoryPolicy ?? {
      includeLongTermMemory: false,
      includeConversationSummary: false
    },
    enabled: overrides.enabled ?? true,
    ...(overrides.executionPolicy === undefined ? {} : { executionPolicy: overrides.executionPolicy }),
    ...(overrides.metadata === undefined ? {} : { metadata: overrides.metadata })
  };
}

describe('createLinnsyAgentRegistry', () => {
  test('auto-registers linnsy_main when no definitions are provided', () => {
    const registry = createLinnsyAgentRegistry();
    const main = registry.getDefaultAgent();
    expect(main.id).toBe(LINNSY_MAIN_AGENT_ID);
    expect(registry.getAgent(LINNSY_MAIN_AGENT_ID)?.displayName).toBe('Linnsy');
    expect(main.toolPolicy.allowedToolIds).toEqual(expect.arrayContaining(['manage_schedule']));
    expect(main.toolPolicy.allowedToolIds).not.toEqual(expect.arrayContaining(['cron_set', 'cron_list', 'cron_remove']));
    expect(main.executionPolicy).toMatchObject({ maxSteps: 40 });
    expect(registry.assertAgent('linnsy_cron_runner')).toMatchObject({
      id: 'linnsy_cron_runner',
      modelPolicy: { model: 'cron_summary' },
      toolPolicy: { allowedToolIds: [] }
    });
    expect(registry.assertAgent('linnsy_general_subagent')).toMatchObject({
      id: 'linnsy_general_subagent',
      metadata: { kind: 'internal_subagent' },
      executionPolicy: { maxSteps: 6 },
      toolPolicy: { allowedToolIds: ['list_tasks', 'get_task_status'] },
      memoryPolicy: {
        includeConversationSummary: false,
        includeLongTermMemory: false
      }
    });
    expect(registry.assertAgent('delegate_to_codex')).toMatchObject({
      id: 'delegate_to_codex',
      metadata: {
        kind: 'external_adapter',
        vendor: 'codex',
        transport: 'codex_exec',
        defaultSandbox: 'workspace-write',
        requiresGitRepo: false
      },
      toolPolicy: { allowedToolIds: [] }
    });
    expect(registry.assertAgent('delegate_to_codex').basePrompt).toContain('manage_task');
  });

  test('preserves registration order and freezes definitions', () => {
    const main = createLinnsyMainAgentDefinition();
    const helper = makeDefinition({ id: 'helper' });
    const registry = createLinnsyAgentRegistry({ definitions: [main, helper] });

    expect(registry.listAgents().map((d) => d.id)).toEqual([LINNSY_MAIN_AGENT_ID, 'helper']);
    const fetched = registry.assertAgent('helper');
    expect(() => {
      (fetched.toolPolicy.allowedToolIds).push('mcp.search');
    }).toThrow(TypeError);
  });

  test('assertAgent throws LINNSY_DEFINITION_NOT_FOUND for unknown id', () => {
    const registry = createLinnsyAgentRegistry();
    expect(registry.getAgent('ghost')).toBeNull();
    expect(() => registry.assertAgent('ghost')).toThrow(LinnsyError);
    try {
      registry.assertAgent('ghost');
    } catch (error) {
      expect(error).toBeInstanceOf(LinnsyError);
      expect((error as LinnsyError).code).toBe(LINNSY_ERROR_CODES.DEFINITION_NOT_FOUND);
    }
  });

  test('rejects duplicate definitions with LINNSY_DEFINITION_INVALID', () => {
    expectThrows(
      () =>
        createLinnsyAgentRegistry({
          definitions: [createLinnsyMainAgentDefinition(), createLinnsyMainAgentDefinition()]
        }),
      LINNSY_ERROR_CODES.DEFINITION_INVALID
    );
  });

  test('rejects malformed definitions with LINNSY_DEFINITION_INVALID', () => {
    expectThrows(
      () =>
        createLinnsyAgentRegistry({
          definitions: [
            createLinnsyMainAgentDefinition({
              modelPolicy: { model: '' }
            })
          ]
        }),
      LINNSY_ERROR_CODES.DEFINITION_INVALID
    );
  });

  test('rejects non-positive executionPolicy.maxSteps', () => {
    expectThrows(
      () =>
        createLinnsyAgentRegistry({
          definitions: [
            createLinnsyMainAgentDefinition({
              executionPolicy: { maxSteps: 0 }
            })
          ]
        }),
      LINNSY_ERROR_CODES.DEFINITION_INVALID
    );
  });

  test('rejects unknown defaultAgentId at boot', () => {
    expectThrows(
      () =>
        createLinnsyAgentRegistry({
          definitions: [createLinnsyMainAgentDefinition()],
          defaultAgentId: 'missing'
        }),
      LINNSY_ERROR_CODES.DEFINITION_NOT_FOUND
    );
  });

  test('registerAtRuntime always throws LINNSY_DEFINITION_REGISTER_AT_RUNTIME', () => {
    const registry = createLinnsyAgentRegistry();
    expectThrows(
      () => registry.registerAtRuntime(makeDefinition({ id: 'late' })),
      LINNSY_ERROR_CODES.DEFINITION_REGISTER_AT_RUNTIME
    );
  });

  test('autoRegisterMain=false requires callers to provide linnsy_main explicitly', () => {
    expectThrows(
      () =>
        createLinnsyAgentRegistry({
          autoRegisterMain: false,
          definitions: [makeDefinition({ id: 'helper' })]
        }),
      LINNSY_ERROR_CODES.DEFINITION_NOT_FOUND
    );
  });
});
