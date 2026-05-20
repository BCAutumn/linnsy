import { describe, expect, test } from 'vitest';

import {
  LINNSY_ERROR_CODES,
  createCodexExecDispatcher,
  createProcessRunner,
  delay,
  join,
  projectLocator,
  seedExternalTask,
  setup,
  waitForTaskStatus
} from './scenarios/codex-exec-dispatcher-support.js';
import type { CapturedRun } from './scenarios/codex-exec-dispatcher-support.js';

describe('CodexExecDispatcher failures', () => {
  test('marks the task failed when codex exits with a non-zero code', async () => {
    const fixture = await setup();
    await seedExternalTask(fixture, 'task_1', 'dispatched', {
      prompt: '会失败'
    });
    const dispatcher = createCodexExecDispatcher({
      taskTracker: fixture.tracker,
      processRunner: createProcessRunner({
        capturedRuns: [],
        stdoutLines: [],
        stderrText: 'not logged in',
        exitCode: 1
      })
    });

    await dispatcher.dispatch({
      taskId: 'task_1',
      definitionKey: 'delegate_to_codex',
      locator: projectLocator(),
      workspacePath: join(fixture.workspaceRoot, 'task_1'),
      payload: {
        prompt: '会失败'
      }
    });
    const task = await waitForTaskStatus(fixture, 'task_1', 'failed');

    expect(task.result?.errorMessage).toBe('codex exec failed: exitCode=1; stderr=not logged in');
  });

  test('reports a non-zero exit without stderr using only the exit code', async () => {
    const fixture = await setup();
    await seedExternalTask(fixture, 'task_1', 'dispatched', {
      prompt: '会失败'
    });
    const dispatcher = createCodexExecDispatcher({
      taskTracker: fixture.tracker,
      processRunner: createProcessRunner({
        capturedRuns: [],
        stdoutLines: [],
        exitCode: 2
      })
    });

    await dispatcher.dispatch({
      taskId: 'task_1',
      definitionKey: 'delegate_to_codex',
      locator: projectLocator(),
      workspacePath: join(fixture.workspaceRoot, 'task_1'),
      payload: {
        prompt: '会失败'
      }
    });
    const task = await waitForTaskStatus(fixture, 'task_1', 'failed');

    expect(task.result?.errorMessage).toBe('codex exec failed: exitCode=2');
  });

  test('keeps a codex error event as the single terminal failure when the process also exits non-zero', async () => {
    const fixture = await setup();
    await seedExternalTask(fixture, 'task_1', 'dispatched', {
      prompt: '模型版本不匹配'
    });
    const dispatcher = createCodexExecDispatcher({
      taskTracker: fixture.tracker,
      processRunner: createProcessRunner({
        capturedRuns: [],
        stdoutLines: [
          {
            type: 'error',
            error: {
              message: 'The model requires a newer version of Codex.'
            }
          }
        ],
        stderrText: 'request failed',
        exitCode: 1
      })
    });

    await dispatcher.dispatch({
      taskId: 'task_1',
      definitionKey: 'delegate_to_codex',
      locator: projectLocator(),
      workspacePath: join(fixture.workspaceRoot, 'task_1'),
      payload: {
        prompt: '模型版本不匹配'
      }
    });
    const task = await waitForTaskStatus(fixture, 'task_1', 'failed');
    await delay(10);

    expect(task.result?.errorMessage).toBe('The model requires a newer version of Codex.');
    expect((await fixture.tracker.get('task_1'))?.status).toBe('failed');
  });

  test('rejects dispatch with unsupported locator kind or missing prompt before spawning codex', async () => {
    const fixture = await setup();
    const capturedRuns: CapturedRun[] = [];
    const dispatcher = createCodexExecDispatcher({
      taskTracker: fixture.tracker,
      processRunner: createProcessRunner({
        capturedRuns,
        stdoutLines: []
      })
    });

    await expect(dispatcher.dispatch({
      taskId: 'task_1',
      definitionKey: 'delegate_to_codex',
      locator: { kind: 'project', label: 'Linnya project', ref: 'project_1' },
      workspacePath: join(fixture.workspaceRoot, 'task_1'),
      payload: { prompt: '不支持 project locator' }
    })).rejects.toMatchObject({ code: LINNSY_ERROR_CODES.TASK_LOCATOR_KIND_NOT_SUPPORTED });
    await expect(dispatcher.dispatch({
      taskId: 'task_2',
      definitionKey: 'delegate_to_codex',
      locator: projectLocator(),
      workspacePath: join(fixture.workspaceRoot, 'task_2'),
      payload: {}
    })).rejects.toMatchObject({ code: LINNSY_ERROR_CODES.EXTERNAL_DISPATCH_FAILED });
    expect(capturedRuns).toEqual([]);
  });

  test('rejects dispatch when locator directory does not exist before spawning codex', async () => {
    const fixture = await setup();
    const capturedRuns: CapturedRun[] = [];
    const dispatcher = createCodexExecDispatcher({
      taskTracker: fixture.tracker,
      processRunner: createProcessRunner({
        capturedRuns,
        stdoutLines: []
      })
    });

    await expect(dispatcher.dispatch({
      taskId: 'task_1',
      definitionKey: 'delegate_to_codex',
      locator: projectLocator(join(fixture.home, 'missing-project')),
      workspacePath: join(fixture.workspaceRoot, 'task_1'),
      payload: { prompt: '目录不存在时不应启动 codex' }
    })).rejects.toMatchObject({ code: LINNSY_ERROR_CODES.TASK_LOCATOR_INVALID });
    expect(capturedRuns).toEqual([]);
  });

});
