import { describe, expect, test } from 'vitest';

import {
  createCodexExecDispatcher,
  createProcessRunner,
  join,
  mkdir,
  projectLocator,
  readCapturedArgs,
  restoreFakeCodexArgsPath,
  seedExternalTask,
  setup,
  waitForTaskStatus,
  writeFakeCodexExecutable
} from './scenarios/codex-exec-dispatcher-support.js';
import type { CapturedRun } from './scenarios/codex-exec-dispatcher-support.js';
import type { RunTerminalEvent, SpawnOptions, SpawnResult } from '../../../../../agent-run/features/run-spawner/types.js';
import { LINNSY_FENCE_KINDS } from '../../../../../agent-run/features/context-engineering/fences.js';
import { createWakeOnTaskTransition } from '../../../../../agent-run/features/run-spawner/wake-on-task-transition.js';

class CapturingSpawner {
  public readonly spawned: SpawnOptions[] = [];

  public spawnDetached(options: SpawnOptions): Promise<SpawnResult> {
    this.spawned.push(options);
    return Promise.resolve({ runId: `run_wake_${this.spawned.length.toString()}`, conversationId: options.conversationId });
  }

  public waitForTerminal(runId: string): Promise<RunTerminalEvent> {
    return Promise.resolve({
      runId,
      type: 'completed',
      outcome: { status: 'completed' }
    });
  }
}

class EmptyRunRegistry {
  public list(): Promise<{ runs: [] }> {
    return Promise.resolve({ runs: [] });
  }
}

describe('CodexExecDispatcher dispatch success', () => {
  test('runs codex exec with JSON output and stores the final message', async () => {
    const fixture = await setup();
    await seedExternalTask(fixture, 'task_1', 'dispatched', {
      prompt: '修复测试'
    });
    const capturedRuns: CapturedRun[] = [];
    const dispatcher = createCodexExecDispatcher({
      taskTracker: fixture.tracker,
      command: 'codex-test',
      model: 'gpt-test',
      processRunner: createProcessRunner({
        capturedRuns,
        stdoutLines: [
          { type: 'session.started', session_id: 'sess_1' },
          { type: 'assistant.delta', message: '正在处理' }
        ],
        finalMessage: 'Codex 完成了任务'
      })
    });

    await dispatcher.dispatch({
      taskId: 'task_1',
      definitionKey: 'delegate_to_codex',
      locator: projectLocator(),
      workspacePath: join(fixture.workspaceRoot, 'task_1'),
      payload: {
        prompt: '修复测试'
      }
    });
    const task = await waitForTaskStatus(fixture, 'task_1', 'completed');

    expect(capturedRuns).toEqual([{
      command: 'codex-test',
      args: [
        'exec',
        '--cd',
        process.cwd(),
        '--skip-git-repo-check',
        '--sandbox',
        'workspace-write',
        '--json',
        '--output-last-message',
        join(fixture.workspaceRoot, 'task_1', 'codex-final.txt'),
        '--model',
        'gpt-test',
        '修复测试'
      ]
    }]);
    expect(task).toMatchObject({
      externalRef: 'sess_1',
      status: 'completed',
      locator: projectLocator(),
      payload: {
        prompt: '修复测试',
        lastFinalMessage: 'Codex 完成了任务'
      },
      result: {
        finalMessage: 'Codex 完成了任务',
        exitCode: 0,
        outputLastMessagePath: join(fixture.workspaceRoot, 'task_1', 'codex-final.txt')
      }
    });
  });

  test('wakes linnsy_main with a task status system-event after fake codex completes', async () => {
    const spawner = new CapturingSpawner();
    const runRegistry = new EmptyRunRegistry();
    const hook = createWakeOnTaskTransition({ spawner, runRegistry });
    const fixture = await setup({ wakeMainOnTransition: () => hook });
    await seedExternalTask(fixture, 'task_1', 'dispatched', {
      prompt: '修复测试'
    });
    const dispatcher = createCodexExecDispatcher({
      taskTracker: fixture.tracker,
      processRunner: createProcessRunner({
        capturedRuns: [],
        stdoutLines: [
          { type: 'session.started', session_id: 'sess_1' },
          { type: 'assistant.delta', message: '正在处理' }
        ],
        finalMessage: 'Codex 完成了任务'
      })
    });

    await dispatcher.dispatch({
      taskId: 'task_1',
      definitionKey: 'delegate_to_codex',
      locator: projectLocator(),
      workspacePath: join(fixture.workspaceRoot, 'task_1'),
      payload: {
        prompt: '修复测试'
      }
    });
    await waitForTaskStatus(fixture, 'task_1', 'completed');

    expect(spawner.spawned).toHaveLength(1);
    expect(spawner.spawned[0]).toMatchObject({
      definitionKey: 'linnsy_main',
      conversationId: 'conv_1',
      wakeSource: 'task-completed'
    });
    expect(spawner.spawned[0]?.contextFences?.[0]).toMatchObject({
      kind: LINNSY_FENCE_KINDS.systemEvent,
      content: 'Codex 完成了任务',
      attrs: {
        kind: 'task_status_change',
        taskId: 'task_1',
        vendor: 'external',
        status: 'completed',
        finalMessage: 'Codex 完成了任务'
      }
    });
  });

  test('falls back to the stdout final message when the final message file is missing', async () => {
    const fixture = await setup();
    await seedExternalTask(fixture, 'task_1', 'dispatched', {
      prompt: '只从 stdout 回传 final'
    });
    const dispatcher = createCodexExecDispatcher({
      taskTracker: fixture.tracker,
      processRunner: createProcessRunner({
        capturedRuns: [],
        stdoutLines: [
          { type: 'response.completed', message: 'stdout final answer' }
        ]
      })
    });

    await dispatcher.dispatch({
      taskId: 'task_1',
      definitionKey: 'delegate_to_codex',
      locator: projectLocator(),
      workspacePath: join(fixture.workspaceRoot, 'task_1'),
      payload: {
        prompt: '只从 stdout 回传 final'
      }
    });
    const task = await waitForTaskStatus(fixture, 'task_1', 'completed');

    expect(task.payload?.lastFinalMessage).toBe('stdout final answer');
    expect(task.result?.finalMessage).toBe('stdout final answer');
  });

  test('spawns a fake codex executable and consumes its NDJSON stream', async () => {
    const fixture = await setup();
    const projectPath = join(fixture.home, 'project');
    const argsPath = join(fixture.home, 'fake-codex-args.json');
    const fakeCodexPath = await writeFakeCodexExecutable(fixture.home);
    await mkdir(projectPath, { recursive: true });
    await seedExternalTask(fixture, 'task_1', 'dispatched', {
      prompt: '请用假 codex 完成任务'
    }, undefined, projectLocator(projectPath));
    const previousArgsPath = process.env.LINNSY_FAKE_CODEX_ARGS_PATH;
    process.env.LINNSY_FAKE_CODEX_ARGS_PATH = argsPath;
    const dispatcher = createCodexExecDispatcher({
      taskTracker: fixture.tracker,
      command: fakeCodexPath,
      sandbox: 'read-only'
    });

    try {
      await dispatcher.dispatch({
        taskId: 'task_1',
        definitionKey: 'delegate_to_codex',
        locator: projectLocator(projectPath),
        workspacePath: join(fixture.workspaceRoot, 'task_1'),
        payload: {
          prompt: '请用假 codex 完成任务'
        }
      });
      const task = await waitForTaskStatus(fixture, 'task_1', 'completed');
      const capturedArgs = await readCapturedArgs(argsPath);

      expect(capturedArgs).toEqual([
        'exec',
        '--cd',
        projectPath,
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '--json',
        '--output-last-message',
        join(fixture.workspaceRoot, 'task_1', 'codex-final.txt'),
        '请用假 codex 完成任务'
      ]);
      expect(task).toMatchObject({
        externalRef: 'fake_session',
        status: 'completed',
        payload: {
          lastFinalMessage: 'fake codex final'
        },
        result: {
          finalMessage: 'fake codex final'
        }
      });
    } finally {
      restoreFakeCodexArgsPath(previousArgsPath);
    }
  });

});
