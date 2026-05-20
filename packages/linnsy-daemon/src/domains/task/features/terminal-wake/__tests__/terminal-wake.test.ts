import { describe, expect, test } from 'vitest';

import type { TaskRecord } from '../../../definitions/task.js';
import { buildTaskExecutionNoticePayload } from '../functions/task-execution-notice.js';
import {
  buildTaskTerminalWakeMetadata,
  buildTaskTransitionWakeQuery,
  buildTaskTransitionWakeQueryForEntries
} from '../functions/task-wake-query.js';

describe('terminal wake task facts', () => {
  test('builds a short wake query without embedding worker output', () => {
    const task = taskRecord({
      status: 'completed',
      result: { finalMessage: 'very long worker result' }
    });

    expect(buildTaskTransitionWakeQuery(task)).toContain('Task 修复测试 reached terminal status: completed.');
    expect(buildTaskTransitionWakeQuery(task)).not.toContain('very long worker result');
  });

  test('builds merged wake query and metadata for multiple terminal tasks', () => {
    const entries = [
      { task: taskRecord({ taskId: 'task_1', title: '修复测试', status: 'completed' }), fromStatus: 'in_progress' as const },
      { task: taskRecord({ taskId: 'task_2', title: '整理文档', status: 'failed' }), fromStatus: 'dispatched' as const }
    ];

    expect(buildTaskTransitionWakeQueryForEntries(entries)).toContain('2 delegated tasks reached terminal status:');
    expect(buildTaskTerminalWakeMetadata(entries)).toEqual({
      taskIds: ['task_1', 'task_2'],
      taskCount: 2,
      statuses: [
        { taskId: 'task_1', fromStatus: 'in_progress', toStatus: 'completed' },
        { taskId: 'task_2', fromStatus: 'dispatched', toStatus: 'failed' }
      ]
    });
  });

  test('builds lightweight execution notice only for completed external tasks', () => {
    expect(buildTaskExecutionNoticePayload(taskRecord({ status: 'completed' }))).toEqual({
      sourceKind: 'task_execution_notice',
      detail: '------ Codex 任务已执行 ------',
      refId: 'task_1',
      occurredAt: 2_000
    });
    expect(buildTaskExecutionNoticePayload(taskRecord({ status: 'failed' }))).toBeNull();
    expect(buildTaskExecutionNoticePayload(taskRecord({ kind: 'internal_subagent', status: 'completed' }))).toBeNull();
  });
});

function taskRecord(patch: Partial<TaskRecord>): TaskRecord {
  return {
    taskId: 'task_1',
    conversationId: 'conv_1',
    kind: 'external',
    attemptCount: 1,
    externalKind: 'codex',
    locator: {
      kind: 'directory',
      label: 'linnsy',
      ref: '/Users/tiansi/code/linnsy'
    },
    title: '修复测试',
    status: 'in_progress',
    createdAt: 1_000,
    updatedAt: 2_000,
    ...patch
  };
}
