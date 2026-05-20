import { describe, expect, test } from 'vitest';

import {
  DEFAULT_LINNSY_WORK_DIR_NAME,
  createDelegateToExternalTool,
  createLinnsyAgentRegistry,
  createLinnsyPathManager,
  createWorkspaceManager,
  externalDefinition,
  join,
  linnsyLocator,
  projectLocator,
  setup,
  toolContext
} from './scenarios/delegate-to-external-support.js';
import type { ExternalAgentDispatcherPort, TaskLocator } from './scenarios/delegate-to-external-support.js';

describe('delegate_to_external happy path', () => {
  test('asserts registry, creates workspace, dispatches, then transitions to dispatched', async () => {
    const fixture = await setup();
    const dispatches: Array<{
      taskId: string;
      definitionKey: string;
      locator: TaskLocator;
      workspacePath: string;
      payload?: Record<string, unknown>;
    }> = [];
    const dispatcher: ExternalAgentDispatcherPort = {
      dispatch(input) {
        dispatches.push({
          taskId: input.taskId,
          definitionKey: input.definitionKey,
          locator: input.locator,
          workspacePath: input.workspacePath,
          ...(input.payload === undefined ? {} : { payload: input.payload })
        });
        return Promise.resolve();
      },
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
      taskIdFactory: () => 'task_1'
    });

    const result = await tool.execute({
      definitionKey: 'delegate_to_codex',
      title: 'Write tests',
      locator: linnsyLocator(),
      payload: {
        prompt: 'Write tests',
        repo: 'linnsy',
        definitionKey: 'delegate_to_cursor'
      }
    }, toolContext());

    expect(result.data).toMatchObject({
      taskId: 'task_1',
      status: 'dispatched',
      workspacePath: join(fixture.workspaceRoot, 'task_1')
    });
    expect(result.observation).toContain('task_1');
    expect(result.observation).toContain('位置=linnsy(/Users/tiansi/code/linnsy)');
    expect(dispatches).toEqual([{
      taskId: 'task_1',
      definitionKey: 'delegate_to_codex',
      locator: linnsyLocator(),
      workspacePath: join(fixture.workspaceRoot, 'task_1'),
      payload: {
        prompt: 'Write tests',
        repo: 'linnsy'
      }
    }]);
    await expect(fixture.tracker.get('task_1')).resolves.toMatchObject({
      taskId: 'task_1',
      conversationId: 'conv_1',
      status: 'dispatched',
      externalKind: 'codex',
      locator: linnsyLocator(),
      payload: {
        definitionKey: 'delegate_to_codex',
        prompt: 'Write tests',
        repo: 'linnsy'
      },
      workspacePath: join(fixture.workspaceRoot, 'task_1')
    });
  });

  test('canonicalizes known external vendor aliases before registry and dispatch', async () => {
    const fixture = await setup();
    const dispatches: Array<{
      taskId: string;
      definitionKey: string;
      locator: TaskLocator;
      workspacePath: string;
      payload?: Record<string, unknown>;
    }> = [];
    const dispatcher: ExternalAgentDispatcherPort = {
      dispatch(input) {
        dispatches.push({
          taskId: input.taskId,
          definitionKey: input.definitionKey,
          locator: input.locator,
          workspacePath: input.workspacePath,
          ...(input.payload === undefined ? {} : { payload: input.payload })
        });
        return Promise.resolve();
      },
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
      taskIdFactory: () => 'task_alias'
    });

    await expect(tool.execute({
      definitionKey: 'Codex',
      title: 'Alias path',
      locator: projectLocator('/tmp/project'),
      payload: { prompt: 'change smoke.txt' }
    }, toolContext())).resolves.toMatchObject({
      data: {
        taskId: 'task_alias',
        status: 'dispatched'
      }
    });

    expect(dispatches).toEqual([{
      taskId: 'task_alias',
      definitionKey: 'delegate_to_codex',
      locator: projectLocator('/tmp/project'),
      workspacePath: join(fixture.workspaceRoot, 'task_alias'),
      payload: { prompt: 'change smoke.txt' }
    }]);
    await expect(fixture.tracker.get('task_alias')).resolves.toMatchObject({
      externalKind: 'codex',
      locator: projectLocator('/tmp/project'),
      payload: {
        definitionKey: 'delegate_to_codex',
        prompt: 'change smoke.txt'
      }
    });
  });

  test('creates a Linnsy Work directory locator when Codex artifact tasks omit locator', async () => {
    const fixture = await setup();
    const dispatches: Array<{
      taskId: string;
      definitionKey: string;
      locator: TaskLocator;
      workspacePath: string;
      payload?: Record<string, unknown>;
    }> = [];
    const dispatcher: ExternalAgentDispatcherPort = {
      dispatch(input) {
        dispatches.push({
          taskId: input.taskId,
          definitionKey: input.definitionKey,
          locator: input.locator,
          workspacePath: input.workspacePath,
          ...(input.payload === undefined ? {} : { payload: input.payload })
        });
        return Promise.resolve();
      },
      continue: () => Promise.resolve(),
      cancel: () => Promise.resolve()
    };
    const registry = createLinnsyAgentRegistry({
      definitions: [externalDefinition()],
      autoRegisterMain: false,
      defaultAgentId: 'delegate_to_codex'
    });
    const pathManager = createLinnsyPathManager({
      env: { HOME: fixture.home },
      linnsyHome: fixture.home,
      linnsyWorkRoot: join(fixture.home, DEFAULT_LINNSY_WORK_DIR_NAME),
      clock: { now: () => new Date('2026-05-10T08:00:00').getTime() }
    });
    const tool = createDelegateToExternalTool({
      registry,
      taskTracker: fixture.tracker,
      workspace: createWorkspaceManager({ root: fixture.workspaceRoot }),
      dispatcher,
      pathManager,
      taskIdFactory: () => 'task_artifact'
    });

    const result = await tool.execute({
      definitionKey: 'delegate_to_codex',
      title: '写 PPT Q3 销售',
      payload: { prompt: '做一个 Q3 销售复盘 PPT' }
    }, toolContext());
    expect(result.data).toMatchObject({
      taskId: 'task_artifact',
      status: 'dispatched'
    });

    const expectedSlug = '写-PPT-Q3-销售-做一个-Q3-销售复盘-PPT-20260510';
    const expectedRef = join(fixture.home, DEFAULT_LINNSY_WORK_DIR_NAME, expectedSlug);
    expect(result.observation).toContain(`位置=${expectedSlug}(${expectedRef})`);
    expect(dispatches).toEqual([{
      taskId: 'task_artifact',
      definitionKey: 'delegate_to_codex',
      locator: {
        kind: 'directory',
        label: expectedSlug,
        ref: expectedRef,
        meta: {
          source: 'linnsy_work',
          root: join(fixture.home, DEFAULT_LINNSY_WORK_DIR_NAME),
          slug: expectedSlug
        }
      },
      workspacePath: join(fixture.workspaceRoot, 'task_artifact'),
      payload: { prompt: '做一个 Q3 销售复盘 PPT' }
    }]);
    await expect(fixture.tracker.get('task_artifact')).resolves.toMatchObject({
      locator: {
        kind: 'directory',
        label: expectedSlug,
        ref: expectedRef,
        meta: { source: 'linnsy_work' }
      }
    });
  });

});
