import { describe, expect, test } from 'vitest';

import {
  LINNSY_ERROR_CODES,
  createCodexExecDispatcher,
  createProcessRunner,
  seedExternalTask,
  setup,
  waitForTaskStatus
} from './scenarios/codex-exec-dispatcher-support.js';
import type { CapturedRun } from './scenarios/codex-exec-dispatcher-support.js';

describe('CodexExecDispatcher continue', () => {
  test('continues an existing codex session with exec resume', async () => {
    const fixture = await setup();
    await seedExternalTask(fixture, 'task_1', 'in_progress', {
      prompt: '初次任务',
      lastFinalMessage: '上次请求审批'
    }, 'sess_1');
    const capturedRuns: CapturedRun[] = [];
    const dispatcher = createCodexExecDispatcher({
      taskTracker: fixture.tracker,
      processRunner: createProcessRunner({
        capturedRuns,
        stdoutLines: [{ type: 'session.resumed', session_id: 'sess_1' }],
        finalMessage: '继续完成'
      })
    });

    await dispatcher.continue({
      taskId: 'task_1',
      message: '主人同意了，继续。'
    });
    const task = await waitForTaskStatus(fixture, 'task_1', 'completed');

    expect(capturedRuns[0]?.args.slice(0, 2)).toEqual(['exec', 'resume']);
    expect(capturedRuns[0]?.args).toContain('sess_1');
    expect(capturedRuns[0]?.args).not.toContain('--cd');
    expect(capturedRuns[0]?.args).not.toContain('--sandbox');
    expect(capturedRuns[0]?.args.at(-1)).toBe('主人同意了，继续。\n\n上次 Codex 最终消息：\n上次请求审批');
    expect(task).toMatchObject({
      externalRef: 'sess_1',
      status: 'completed',
      payload: {
        lastFinalMessage: '继续完成'
      },
      result: {
        finalMessage: '继续完成'
      }
    });
  });

  test('continues without the previous final message when no approval text was saved', async () => {
    const fixture = await setup();
    await seedExternalTask(fixture, 'task_1', 'in_progress', {
      prompt: '初次任务'
    }, 'sess_1');
    const capturedRuns: CapturedRun[] = [];
    const dispatcher = createCodexExecDispatcher({
      taskTracker: fixture.tracker,
      processRunner: createProcessRunner({
        capturedRuns,
        stdoutLines: [{ type: 'session.resumed', session_id: 'sess_1' }],
        finalMessage: '继续完成'
      })
    });

    await dispatcher.continue({
      taskId: 'task_1',
      message: '继续。'
    });
    await waitForTaskStatus(fixture, 'task_1', 'completed');

    expect(capturedRuns[0]?.args.at(-1)).toBe('继续。');
  });

  test('rejects continue without session id or locator before spawning codex', async () => {
    const fixture = await setup();
    await seedExternalTask(fixture, 'task_without_session', 'in_progress', {
      prompt: '初次任务'
    });
    await seedExternalTask(fixture, 'task_without_cwd', 'in_progress', {
      prompt: '初次任务'
    }, 'sess_1', undefined);
    const capturedRuns: CapturedRun[] = [];
    const dispatcher = createCodexExecDispatcher({
      taskTracker: fixture.tracker,
      processRunner: createProcessRunner({
        capturedRuns,
        stdoutLines: []
      })
    });

    await expect(dispatcher.continue({
      taskId: 'task_without_session',
      message: '继续。'
    })).rejects.toMatchObject({ code: LINNSY_ERROR_CODES.EXTERNAL_SESSION_NOT_FOUND });
    await expect(dispatcher.continue({
      taskId: 'task_without_cwd',
      message: '继续。'
    })).rejects.toMatchObject({ code: LINNSY_ERROR_CODES.TASK_LOCATOR_INVALID });
    expect(capturedRuns).toEqual([]);
  });

});
