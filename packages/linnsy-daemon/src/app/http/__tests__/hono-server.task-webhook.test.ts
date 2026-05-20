import {
  describe,
  expect,
  test,
  vi
} from 'vitest';

import {
  LINNSY_ERROR_CODES,
  createTaskWebhookApp,
  memoryStore,
  taskTracker,
  uiPreferencesStore,
  withOptionalNode
} from './scenarios/hono-server-support.js';

describe('task webhook Hono server', () => {
  test('accepts a valid task update with bearer auth', async () => {
    const updates: Array<{ taskId: string; node?: string }> = [];
    const app = createTaskWebhookApp({
      bearerToken: 'secret',
      taskTracker: taskTracker({
        onExternalUpdate(taskId, update) {
          updates.push(withOptionalNode({ taskId }, update.node));
          return Promise.resolve('should_notify');
        }
      })
    });

    const response = await app.request('/api/v1/tasks/task_1/update', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ node: 'done', finalResult: { ok: true } })
    });

    await expect(response.json()).resolves.toEqual({ ok: true, action: 'should_notify' });
    expect(response.status).toBe(200);
    expect(updates).toEqual([{ taskId: 'task_1', node: 'done' }]);
  });

  test('rejects missing or wrong bearer without calling TaskTracker', async () => {
    const onExternalUpdate = vi.fn();
    const app = createTaskWebhookApp({
      bearerToken: 'secret',
      taskTracker: taskTracker({ onExternalUpdate })
    });

    const response = await app.request('/api/v1/tasks/task_1/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node: 'done' })
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: LINNSY_ERROR_CODES.HTTP_BEARER_REQUIRED
    });
    expect(onExternalUpdate).not.toHaveBeenCalled();
  });

  test('rejects malformed task updates before calling TaskTracker', async () => {
    const onExternalUpdate = vi.fn();
    const app = createTaskWebhookApp({
      bearerToken: 'secret',
      taskTracker: taskTracker({ onExternalUpdate })
    });

    const response = await app.request('/api/v1/tasks/task_1/update', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status: 'almost_done',
        finalResult: { ok: true },
        unexpected: true
      })
    });

    expect(response.status).toBe(400);
    expect(onExternalUpdate).not.toHaveBeenCalled();
  });

  test('passes typed task update status through the webhook contract', async () => {
    const updates: Array<{ taskId: string; status?: string }> = [];
    const app = createTaskWebhookApp({
      bearerToken: 'secret',
      taskTracker: taskTracker({
        onExternalUpdate(taskId, update) {
          updates.push(update.status === undefined
            ? { taskId }
            : { taskId, status: update.status });
          return Promise.resolve('silent');
        }
      })
    });

    const response = await app.request('/api/v1/tasks/task_1/update', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'in_progress', partialResult: { step: 1 } })
    });

    expect(response.status).toBe(200);
    expect(updates).toEqual([{ taskId: 'task_1', status: 'in_progress' }]);
  });

  test('answers CORS preflight from Vite dev origin (loopback)', async () => {
    const app = createTaskWebhookApp({
      bearerToken: 'secret',
      taskTracker: taskTracker({})
    });

    const response = await app.request('/api/v1/tasks/task_1/update', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://127.0.0.1:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type'
      }
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5173');
    const allowHeaders = (response.headers.get('access-control-allow-headers') ?? '').toLowerCase();
    expect(allowHeaders).toContain('authorization');
    expect(allowHeaders).toContain('content-type');
    const allowMethods = (response.headers.get('access-control-allow-methods') ?? '').toUpperCase();
    expect(allowMethods).toContain('POST');
    expect(allowMethods).toContain('OPTIONS');
  });

  test('answers CORS preflight from Electron file:// renderer (Origin: null)', async () => {
    const app = createTaskWebhookApp({
      bearerToken: 'secret',
      taskTracker: taskTracker({})
    });

    const response = await app.request('/api/v1/tasks/task_1/update', {
      method: 'OPTIONS',
      headers: {
        Origin: 'null',
        'Access-Control-Request-Method': 'GET'
      }
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('null');
  });

  test('refuses CORS preflight from non-loopback origins', async () => {
    const app = createTaskWebhookApp({
      bearerToken: 'secret',
      taskTracker: taskTracker({})
    });

    const response = await app.request('/api/v1/tasks/task_1/update', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example.com',
        'Access-Control-Request-Method': 'POST'
      }
    });

    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('applies the default-deny bearer boundary to mounted preference, memory, and application routes', async () => {
    const app = createTaskWebhookApp({
      bearerToken: 'secret',
      taskTracker: taskTracker({}),
      uiPreferencesStore: uiPreferencesStore(),
      memoryStore: memoryStore(),
      codexProbe: {
        probe: () => Promise.resolve({
          status: 'not_found',
          command: 'codex',
          checkedAt: 1
        })
      }
    });

    const preferencesRejected = await app.request('/api/v1/ui-preferences');
    const memoryRejected = await app.request('/api/v1/memory/items');
    const applicationConnectionsRejected = await app.request('/api/v1/application-connections');
    const preferencesAccepted = await app.request('/api/v1/ui-preferences', {
      headers: { Authorization: 'Bearer secret' }
    });
    const memoryAccepted = await app.request('/api/v1/memory/items', {
      headers: { Authorization: 'Bearer secret' }
    });
    const applicationConnectionsAccepted = await app.request('/api/v1/application-connections', {
      headers: { Authorization: 'Bearer secret' }
    });

    expect(preferencesRejected.status).toBe(401);
    expect(memoryRejected.status).toBe(401);
    expect(applicationConnectionsRejected.status).toBe(401);
    expect(preferencesAccepted.status).toBe(200);
    expect(memoryAccepted.status).toBe(200);
    expect(applicationConnectionsAccepted.status).toBe(200);
  });

});
