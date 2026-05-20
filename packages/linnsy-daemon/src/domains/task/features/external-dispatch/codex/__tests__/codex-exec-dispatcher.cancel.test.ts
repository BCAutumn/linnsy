import { describe, expect, test } from 'vitest';

import {
  createCodexExecDispatcher,
  createLongRunningProcessRunner,
  delay,
  join,
  projectLocator,
  seedExternalTask,
  setup
} from './scenarios/codex-exec-dispatcher-support.js';

describe('CodexExecDispatcher cancellation', () => {
  test('sends SIGTERM and ignores the killed process result when cancelled', async () => {
    const fixture = await setup();
    await seedExternalTask(fixture, 'task_1', 'dispatched', {
      prompt: '长任务'
    });
    const killedSignals: Array<NodeJS.Signals | undefined> = [];
    const dispatcher = createCodexExecDispatcher({
      taskTracker: fixture.tracker,
      processRunner: createLongRunningProcessRunner(killedSignals)
    });

    await dispatcher.dispatch({
      taskId: 'task_1',
      definitionKey: 'delegate_to_codex',
      locator: projectLocator(),
      workspacePath: join(fixture.workspaceRoot, 'task_1'),
      payload: {
        prompt: '长任务'
      }
    });
    await dispatcher.cancel({ taskId: 'task_1', reason: '主人取消' });
    await fixture.tracker.transition('task_1', 'cancelled', {
      cancelledAt: 1_000,
      cancelReason: '主人取消'
    });
    await delay(10);

    expect(killedSignals).toEqual(['SIGTERM']);
    await expect(fixture.tracker.get('task_1')).resolves.toMatchObject({
      status: 'cancelled',
      cancelReason: '主人取消'
    });
  });

});
