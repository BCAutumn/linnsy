import type { ToolExecutionContext, ToolExecutionResult, ToolRuntimeDefinition, ToolRuntimePort } from '@linnlabs/linnkit/runtime-kernel';
import { describe, expect, test } from 'vitest';

import { createPolicyScopedToolRuntime } from '../policy-scoped-tool-runtime.js';

describe('createPolicyScopedToolRuntime', () => {
  test('blocks tool execution when the run policy does not allow the requested tool', async () => {
    const base = new FakeToolRuntime(['list_tasks', 'delegate_to_internal']);
    const runtime = createPolicyScopedToolRuntime(base);
    runtime.setAllowedToolIdsForRun('run_child', ['list_tasks']);

    const blocked = await runtime.executeTool('delegate_to_internal', {}, { runId: 'run_child' });
    const allowed = await runtime.executeTool('list_tasks', {}, { runId: 'run_child' });

    expect(blocked).toMatchObject({
      success: false,
      errorKind: 'protocol'
    });
    expect(blocked.error).toContain('not allowed');
    expect(allowed).toMatchObject({
      success: true,
      result: '{"toolName":"list_tasks"}'
    });
    expect(base.executed).toEqual(['list_tasks']);
  });

  test('returns only schemas allowed for a scoped run', () => {
    const base = new FakeToolRuntime(['list_tasks', 'get_task_status', 'cron_set']);
    const runtime = createPolicyScopedToolRuntime(base);
    runtime.setAllowedToolIdsForRun('run_child', ['list_tasks', 'get_task_status']);

    expect(runtime.getToolSchemasForRun('run_child').map((schema) => schema.function.name)).toEqual([
      'list_tasks',
      'get_task_status'
    ]);
  });

  test('clears per-run policy after a run finishes', async () => {
    const base = new FakeToolRuntime(['cron_set']);
    const runtime = createPolicyScopedToolRuntime(base);
    runtime.setAllowedToolIdsForRun('run_child', []);
    runtime.clearAllowedToolIdsForRun('run_child');

    const result = await runtime.executeTool('cron_set', {}, { runId: 'run_child' });

    expect(result).toMatchObject({ success: true });
    expect(base.executed).toEqual(['cron_set']);
  });

  test('scopes policy setup and cleanup in one lifecycle helper', async () => {
    const base = new FakeToolRuntime(['list_tasks', 'cron_set']);
    const runtime = createPolicyScopedToolRuntime(base);

    await expect(runtime.runWithAllowedToolIdsForRun('run_child', ['list_tasks'], async () => {
      const blocked = await runtime.executeTool('cron_set', {}, { runId: 'run_child' });
      expect(blocked).toMatchObject({ success: false, errorKind: 'protocol' });
      throw new Error('run failed');
    })).rejects.toThrow('run failed');

    const afterFailure = await runtime.executeTool('cron_set', {}, { runId: 'run_child' });
    expect(afterFailure).toMatchObject({ success: true });
    expect(base.executed).toEqual(['cron_set']);
  });
});

class FakeToolRuntime implements ToolRuntimePort {
  public readonly executed: string[] = [];

  public constructor(private readonly toolNames: string[]) {}

  public getToolSchemas(toolNames?: string[]) {
    const names = toolNames ?? this.toolNames;
    return names
      .filter((name) => this.toolNames.includes(name))
      .map((name) => ({
        type: 'function' as const,
        function: {
          name,
          description: `${name} description`,
          parameters: { type: 'object' as const, properties: {} }
        }
      }));
  }

  public getToolDefinition(toolName: string): ToolRuntimeDefinition | undefined {
    if (!this.toolNames.includes(toolName)) {
      return undefined;
    }
    return {
      parameters: { type: 'object', properties: {} }
    };
  }

  public getDisplayOptions() {
    return undefined;
  }

  public executeTool(toolName: string, args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    void args;
    void context;
    this.executed.push(toolName);
    return Promise.resolve({
      success: true,
      result: JSON.stringify({ toolName }),
      durationMs: 1
    });
  }
}
