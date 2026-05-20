import { describe, expect, test, vi } from 'vitest';

import type { TaskRecord } from '../../../../../definitions/task.js';
import type { TaskTrackerPort } from '../../../../../ports/task-tracker-port.js';
import type { CodexSessionBridgePort } from '../../codex-session-bridge.js';
import { createCodexSessionRoutes } from '../codex-session-routes.js';

describe('codex session routes', () => {
  test('returns a safe Codex task session snapshot', async () => {
    const summarizeTask = vi.fn<CodexSessionBridgePort['summarizeTask']>(() => ({
      taskId: 'task_1',
      title: 'Codex task',
      status: 'completed',
      sessionId: 'session_1',
      canOpen: true
    }));
    const app = createCodexSessionRoutes({
      taskTracker: taskTracker({
        get: () => Promise.resolve(sampleTask({ externalKind: 'codex' }))
      }),
      codexSessionBridge: {
        summarizeTask,
        listProjects: () => Promise.resolve([]),
        listRecentThreads: () => Promise.resolve([]),
        getThread: () => Promise.resolve(null)
      }
    });

    const response = await app.request('/api/v1/codex/tasks/task_1/session');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      session: {
        taskId: 'task_1',
        title: 'Codex task',
        status: 'completed',
        sessionId: 'session_1',
        canOpen: true
      }
    });
    expect(summarizeTask).toHaveBeenCalledTimes(1);
  });

  test('rejects non-Codex tasks', async () => {
    const app = createCodexSessionRoutes({
      taskTracker: taskTracker({
        get: () => Promise.resolve(sampleTask({ externalKind: 'cursor' }))
      }),
      codexSessionBridge: {
        summarizeTask: () => {
          throw new Error('not used');
        },
        listProjects: () => Promise.resolve([]),
        listRecentThreads: () => Promise.resolve([]),
        getThread: () => Promise.resolve(null)
      }
    });

    const response = await app.request('/api/v1/codex/tasks/task_1/session');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'LINNSY_EXTERNAL_SESSION_NOT_FOUND'
    });
  });

  test('lists recent thread metadata', async () => {
    const app = createCodexSessionRoutes({
      taskTracker: taskTracker({}),
      codexSessionBridge: {
        summarizeTask: () => {
          throw new Error('not used');
        },
        listProjects: () => Promise.resolve([]),
        listRecentThreads: (options) => Promise.resolve([{
          id: `thread_${String(options?.limit ?? 0)}_${options?.cwd ?? 'all'}_${String(options?.includeChildDirectories ?? false)}`,
          updatedAt: 1,
          threadName: '最近对话'
        }]),
        getThread: () => Promise.resolve(null)
      }
    });

    const response = await app.request('/api/v1/codex/threads/recent?limit=3&cwd=%2FUsers%2Ftiansi%2Fcode%2Flinnsy&includeChildDirectories=true');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      threads: [{
        id: 'thread_3_/Users/tiansi/code/linnsy_true',
        updatedAt: 1,
        threadName: '最近对话'
      }]
    });
  });

  test('lists Codex project groups', async () => {
    const app = createCodexSessionRoutes({
      taskTracker: taskTracker({}),
      codexSessionBridge: {
        summarizeTask: () => {
          throw new Error('not used');
        },
        listProjects: (options) => Promise.resolve([{
          cwd: '/Users/tiansi/code/linnsy',
          label: `linnsy_${String(options?.limit ?? 0)}`,
          threadCount: 2,
          latestUpdatedAt: 10
        }]),
        listRecentThreads: () => Promise.resolve([]),
        getThread: () => Promise.resolve(null)
      }
    });

    const response = await app.request('/api/v1/codex/projects?limit=5');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      projects: [{
        cwd: '/Users/tiansi/code/linnsy',
        label: 'linnsy_5',
        threadCount: 2,
        latestUpdatedAt: 10
      }]
    });
  });
});

function sampleTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    taskId: 'task_1',
    conversationId: 'conv_1',
    kind: 'external',
    attemptCount: 1,
    externalKind: 'codex',
    title: 'Codex task',
    status: 'completed',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  };
}

function taskTracker(overrides: Partial<TaskTrackerPort>): TaskTrackerPort {
  return {
    upsert: () => Promise.reject(new Error('not used')),
    transition: () => Promise.reject(new Error('not used')),
    delete: () => Promise.reject(new Error('not used')),
    get: () => Promise.resolve(null),
    list: () => Promise.resolve([]),
    onExternalUpdate: () => Promise.resolve('silent'),
    ...overrides
  };
}
