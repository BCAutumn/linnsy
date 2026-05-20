import {
  describe,
  expect,
  test,
  vi
} from 'vitest';

import {
  createDelegateToExternalTool,
  createLinnsyAgentRegistry,
  createLinnsyToolRuntime,
  createMockExternalAgentDispatcher,
  createWorkspaceManager,
  externalDefinition,
  join,
  linnsyLocator,
  mkdir,
  noopDispatcher,
  setup,
  toolContext
} from './scenarios/delegate-to-external-support.js';
import type { ExternalAgentDispatcherPort } from './scenarios/delegate-to-external-support.js';

describe('delegate_to_external dispatcher and runtime', () => {
  test('marks the task failed when the external dispatcher rejects missing Codex prompt after task creation', async () => {
    const fixture = await setup();
    const dispatcher: ExternalAgentDispatcherPort = {
      dispatch: () => Promise.reject(new Error('codex dispatcher requires payload.prompt')),
      continue: () => Promise.resolve(),
      cancel: () => Promise.resolve()
    };
    const registry = createLinnsyAgentRegistry({
      definitions: [externalDefinition()],
      autoRegisterMain: false,
      defaultAgentId: 'delegate_to_codex'
    });
    const tool = createDelegateToExternalTool({
      registry,
      taskTracker: fixture.tracker,
      workspace: createWorkspaceManager({ root: fixture.workspaceRoot }),
      dispatcher,
      taskIdFactory: () => 'task_missing_prompt'
    });

    await expect(tool.execute({
      definitionKey: 'delegate_to_codex',
      title: 'Missing prompt',
      locator: linnsyLocator()
    }, toolContext())).rejects.toThrow('codex dispatcher requires payload.prompt');
    await expect(fixture.tracker.get('task_missing_prompt')).resolves.toMatchObject({
      status: 'failed',
      locator: linnsyLocator()
    });
  });

  test('marks the task failed when the external dispatcher rejects after task creation', async () => {
    const fixture = await setup();
    const dispatcher: ExternalAgentDispatcherPort = {
      dispatch: () => Promise.reject(new Error('codex spawn failed')),
      continue: () => Promise.resolve(),
      cancel: () => Promise.resolve()
    };
    const registry = createLinnsyAgentRegistry({
      definitions: [externalDefinition()],
      autoRegisterMain: false,
      defaultAgentId: 'delegate_to_codex'
    });
    const tool = createDelegateToExternalTool({
      registry,
      taskTracker: fixture.tracker,
      workspace: createWorkspaceManager({ root: fixture.workspaceRoot }),
      dispatcher,
      taskIdFactory: () => 'task_failed'
    });

    await expect(tool.execute({
      definitionKey: 'delegate_to_codex',
      title: 'Will fail',
      locator: linnsyLocator(),
      payload: { prompt: 'try and fail' }
    }, toolContext())).rejects.toThrow('codex spawn failed');
    await expect(fixture.tracker.get('task_failed')).resolves.toMatchObject({
      status: 'failed',
      result: { errorMessage: 'codex spawn failed' }
    });
  });

  test('registers delegate_to_external in the tool runtime', async () => {
    const fixture = await setup();
    const runtime = createLinnsyToolRuntime({
      tools: [
        createDelegateToExternalTool({
          registry: createLinnsyAgentRegistry({
            definitions: [externalDefinition()],
            autoRegisterMain: false,
            defaultAgentId: 'delegate_to_codex'
          }),
          taskTracker: fixture.tracker,
          workspace: createWorkspaceManager({ root: fixture.workspaceRoot }),
          dispatcher: noopDispatcher(),
          taskIdFactory: () => 'task_1'
        })
      ]
    });

    expect(runtime.getToolSchemas().map((schema) => schema.function.name)).toEqual(['delegate_to_external']);
    const result = await runtime.executeTool('delegate_to_external', {
      definitionKey: 'delegate_to_codex',
      title: 'Runtime path',
      locator: linnsyLocator(),
      payload: { prompt: 'runtime smoke' }
    }, toolContext());

    expect(result).toMatchObject({ success: true });
    expect(result.result).toContain('task_1');
  });

  test('mock external dispatcher schedules progress and final updates through the injected timer', async () => {
    const fixture = await setup();
    await mkdir(join(fixture.workspaceRoot, 'task_1'), { recursive: true });
    await fixture.tracker.upsert({
      taskId: 'task_1',
      conversationId: 'conv_1',
      title: 'Mock',
      status: 'dispatched',
      workspacePath: join(fixture.workspaceRoot, 'task_1')
    });
    const callbacks: Array<() => Promise<void>> = [];
    const dispatcher = createMockExternalAgentDispatcher({
      taskTracker: fixture.tracker,
      timer: {
        setTimeout(callback) {
          callbacks.push(callback);
          return callbacks.length;
        },
        clearTimeout: vi.fn()
      },
      nodeSequence: ['queued', 'working'],
      nodeIntervalMs: 10,
      finalResult: (input) => ({ ok: true, workspacePath: input.workspacePath })
    });

    await dispatcher.dispatch({
      taskId: 'task_1',
      definitionKey: 'delegate_to_codex',
      locator: linnsyLocator(),
      workspacePath: join(fixture.workspaceRoot, 'task_1')
    });

    expect(callbacks.length).toBe(3);
    for (const callback of callbacks) {
      await callback();
    }
    await expect(fixture.tracker.get('task_1')).resolves.toMatchObject({
      status: 'completed',
      lastNode: 'completed',
      result: { ok: true, workspacePath: join(fixture.workspaceRoot, 'task_1') }
    });
  });

  test('mock external dispatcher clears scheduled updates when cancelled', async () => {
    const fixture = await setup();
    await fixture.tracker.upsert({
      taskId: 'task_1',
      conversationId: 'conv_1',
      title: 'Mock',
      status: 'dispatched',
      workspacePath: join(fixture.workspaceRoot, 'task_1')
    });
    const clearedHandles: unknown[] = [];
    let nextHandle = 1;
    const dispatcher = createMockExternalAgentDispatcher({
      taskTracker: fixture.tracker,
      timer: {
        setTimeout() {
          const handle = nextHandle;
          nextHandle += 1;
          return handle;
        },
        clearTimeout(handle) {
          clearedHandles.push(handle);
        }
      },
      nodeSequence: ['queued', 'working']
    });

    await dispatcher.dispatch({
      taskId: 'task_1',
      definitionKey: 'delegate_to_codex',
      locator: linnsyLocator(),
      workspacePath: join(fixture.workspaceRoot, 'task_1')
    });
    await dispatcher.cancel({ taskId: 'task_1', reason: 'owner stopped it' });

    expect(clearedHandles).toEqual([1, 2, 3]);
  });

});
