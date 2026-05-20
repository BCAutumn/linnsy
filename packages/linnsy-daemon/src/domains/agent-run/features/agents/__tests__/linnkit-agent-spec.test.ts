import { describe, expect, test } from 'vitest';

import { LINNSY_FENCE_KINDS } from '../../context-engineering/fences.js';
import {
  createLinnsyCronRunnerDefinition,
  createLinnsyEchoSubagentDefinition,
  createLinnsyGeneralSubagentDefinition,
  createLinnsyMainAgentDefinition
} from '../index.js';
import { createLinnsyAgentSpec } from '../linnkit-agent-spec.js';

describe('createLinnsyAgentSpec', () => {
  test('builds a linnkit-validated spec with Linnsy default context policy', () => {
    const definition = createLinnsyMainAgentDefinition();

    const spec = createLinnsyAgentSpec(definition);

    expect(spec.id).toBe(definition.id);
    expect(spec.version).toBe('1');
    expect(spec.contextPolicy.profileId).toBe(definition.systemPromptId);
    expect(spec.contextPolicy.budget).toMatchObject({
      maxTokens: 120_000,
      reservedForResponse: 2_400,
      workingMemoryBudgetPercentage: 0.7
    });
    expect(spec.contextPolicy.toolHistory?.strategy).toBe('per-run');
    expect(spec.contextPolicy.toolHistory?.maxInteractionGroups).toBe(12);
    expect(spec.contextPolicy.tokenEstimation?.avgCharsPerToken).toBe(1.7);
    expect(spec.contextPolicy.workingMemory).toMatchObject({
      minToolInteractionsToKeep: 2,
      maxRecentToolInteractions: 2,
      toolPairingSearchRange: 10
    });
    expect(spec.contextPolicy.mustKeep?.alwaysKeepFenceKinds).toEqual(Object.values(LINNSY_FENCE_KINDS));
    expect(spec.contextPolicy.mustKeep?.truncationRules).toContainEqual({
      fenceKind: LINNSY_FENCE_KINDS.memoryContext,
      maxBudgetFraction: 0.2,
      strategyName: 'linnsy-memory-context-budget'
    });
    expect(spec.tools.map((tool) => tool.toolId)).toEqual(definition.toolPolicy.allowedToolIds);
  });

  test('merges agent-level context overrides without losing Linnsy defaults', () => {
    const definition = createLinnsyGeneralSubagentDefinition({
      contextPolicy: {
        budget: {
          maxTokens: 48_000,
          reservedForResponse: 3_000
        },
        toolHistory: {
          keepLatestRuns: 2,
          maxInteractionGroups: 12
        },
        contextTrace: {
          enabled: true,
          includeTokenBreakdown: true,
          maxTraceEvents: 200
        },
        tokenEstimation: {
          avgCharsPerToken: 1.5
        }
      }
    });

    const spec = createLinnsyAgentSpec(definition);

    expect(spec.contextPolicy.profileId).toBe(definition.systemPromptId);
    expect(spec.contextPolicy.budget).toMatchObject({
      maxTokens: 48_000,
      reservedForResponse: 3_000
    });
    expect(spec.contextPolicy.toolHistory).toMatchObject({
      strategy: 'per-run',
      keepLatestRuns: 2,
      maxInteractionGroups: 12
    });
    expect(spec.contextPolicy.contextTrace).toMatchObject({
      enabled: true,
      includeTokenBreakdown: true,
      maxTraceEvents: 200
    });
    expect(spec.contextPolicy.tokenEstimation?.avgCharsPerToken).toBe(1.5);
    expect(spec.contextPolicy.mustKeep?.alwaysKeepFenceKinds).toEqual(Object.values(LINNSY_FENCE_KINDS));
  });

  test('keeps child and cron agent context policies bounded by their product role', () => {
    const general = createLinnsyAgentSpec(createLinnsyGeneralSubagentDefinition());
    const echo = createLinnsyAgentSpec(createLinnsyEchoSubagentDefinition());
    const cron = createLinnsyAgentSpec(createLinnsyCronRunnerDefinition());

    expect(general.contextPolicy.budget).toMatchObject({
      maxTokens: 32_000,
      reservedForResponse: 1_600,
      workingMemoryBudgetPercentage: 0.55
    });
    expect(general.contextPolicy.toolHistory).toMatchObject({
      strategy: 'per-run',
      keepLatestRuns: 1,
      maxInteractionGroups: 4
    });
    expect(general.contextPolicy.workingMemory).toMatchObject({
      minToolInteractionsToKeep: 1,
      maxRecentToolInteractions: 1,
      toolPairingSearchRange: 6
    });

    expect(echo.contextPolicy.budget?.maxTokens).toBe(8_000);
    expect(echo.contextPolicy.toolHistory?.strategy).toBe('none');
    expect(cron.contextPolicy.budget?.maxTokens).toBe(16_000);
    expect(cron.contextPolicy.toolHistory?.strategy).toBe('none');
  });

  test('does not let definitions override profileId away from systemPromptId', () => {
    const definition = createLinnsyMainAgentDefinition({
      contextPolicy: {
        budget: { maxTokens: 64_000 }
      }
    });

    const spec = createLinnsyAgentSpec(definition);

    expect(spec.contextPolicy.profileId).toBe(definition.systemPromptId);
    expect(spec.contextPolicy.profileId).not.toBe('agent');
  });

  test('copies serializable tool argument schemas into tool bindings when a schema source is available', () => {
    const definition = createLinnsyMainAgentDefinition({
      toolPolicy: {
        allowedToolIds: ['list_tasks', 'get_task_status']
      }
    });

    const spec = createLinnsyAgentSpec(definition, {
      toolSchemaSource: {
        getToolSchemas(toolNames?: string[]) {
          expect(toolNames).toEqual(['list_tasks', 'get_task_status']);
          return [
            {
              function: {
                name: 'list_tasks',
                parameters: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' }
                  }
                }
              }
            },
            {
              function: {
                name: 'get_task_status',
                parameters: {
                  type: 'object',
                  properties: {
                    taskId: { type: 'string' }
                  },
                  required: ['taskId']
                }
              }
            }
          ];
        }
      }
    });

    expect(spec.tools).toEqual([
      {
        toolId: 'list_tasks',
        argsSchema: {
          type: 'object',
          properties: {
            status: { type: 'string' }
          }
        }
      },
      {
        toolId: 'get_task_status',
        argsSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string' }
          },
          required: ['taskId']
        }
      }
    ]);
  });
});
