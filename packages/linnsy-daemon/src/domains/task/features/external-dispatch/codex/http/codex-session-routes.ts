import type { Context } from 'hono';
import { Hono } from 'hono';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../../shared/errors.js';
import type { TaskTrackerPort } from '../../../../ports/task-tracker-port.js';
import type { CodexSessionBridgePort } from '../codex-session-bridge.js';

export interface CreateCodexSessionRoutesOptions {
  taskTracker: TaskTrackerPort;
  codexSessionBridge: CodexSessionBridgePort;
}

export function createCodexSessionRoutes(options: CreateCodexSessionRoutesOptions): Hono {
  const app = new Hono();

  app.get('/api/v1/codex/tasks/:taskId/session', async (context) => {
    const taskId = context.req.param('taskId');
    const task = await options.taskTracker.get(taskId);
    if (task === null) {
      return mapCodexSessionError(context, new LinnsyError(
        LINNSY_ERROR_CODES.TASK_NOT_FOUND,
        `task ${taskId} was not found`,
        false
      ));
    }
    if (task.externalKind !== 'codex') {
      return mapCodexSessionError(context, new LinnsyError(
        LINNSY_ERROR_CODES.EXTERNAL_SESSION_NOT_FOUND,
        `task ${taskId} is not a Codex task`,
        false
      ));
    }
    return context.json({
      ok: true,
      session: options.codexSessionBridge.summarizeTask(task)
    });
  });

  app.get('/api/v1/codex/threads/recent', async (context) => {
    const limit = readLimit(context.req.query('limit'));
    const cwd = readNonEmptyQuery(context.req.query('cwd'));
    const includeChildDirectories = readBoolean(context.req.query('includeChildDirectories'));
    return context.json({
      ok: true,
      threads: await options.codexSessionBridge.listRecentThreads({
        ...(limit === undefined ? {} : { limit }),
        ...(cwd === undefined ? {} : { cwd }),
        ...(includeChildDirectories === undefined ? {} : { includeChildDirectories })
      })
    });
  });

  app.get('/api/v1/codex/projects', async (context) => {
    const limit = readLimit(context.req.query('limit'));
    return context.json({
      ok: true,
      projects: await options.codexSessionBridge.listProjects(limit === undefined ? {} : { limit })
    });
  });

  return app;
}

function readLimit(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const limit = Number(value);
  return Number.isInteger(limit) ? limit : undefined;
}

function readNonEmptyQuery(value: string | undefined): string | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
}

function readBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return undefined;
}

function mapCodexSessionError(context: Context, error: LinnsyError): Response {
  return context.json({
    ok: false,
    code: error.code,
    message: error.message
  }, error.code === LINNSY_ERROR_CODES.TASK_NOT_FOUND ? 404 : 400);
}
