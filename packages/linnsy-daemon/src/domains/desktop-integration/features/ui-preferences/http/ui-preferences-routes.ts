import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { LinnsyError } from '../../../../../shared/errors.js';

export const UI_PREFERENCE_ROUTE_ERROR_CODES = {
  KEY_UNKNOWN: 'LINNSY_UI_PREFERENCE_KEY_UNKNOWN',
  VALUE_INVALID: 'LINNSY_UI_PREFERENCE_VALUE_INVALID'
} as const;

export interface UiPreferencesRoutesStorePort {
  get(key: string): Promise<unknown>;
  getAll(): Promise<Record<string, unknown>>;
  set(key: string, value: unknown): Promise<void>;
  reset(key: string): Promise<void>;
}

export interface CreateUiPreferencesRoutesOptions {
  store: UiPreferencesRoutesStorePort;
}

const preferenceValueSchema = z
  .object({
    value: z.unknown()
  })
  .strict();

export function createUiPreferencesRoutes(options: CreateUiPreferencesRoutesOptions): Hono {
  const app = new Hono();

  app.get('/api/v1/ui-preferences', async (context) => {
    const preferences = await options.store.getAll();
    return context.json({ ok: true, preferences });
  });

  app.get('/api/v1/ui-preferences/:key', async (context) => {
    try {
      const key = context.req.param('key');
      const value = await options.store.get(key);
      return context.json({ ok: true, key, value });
    } catch (error: unknown) {
      return uiPreferencesErrorResponse(context, error);
    }
  });

  app.put(
    '/api/v1/ui-preferences/:key',
    zValidator('json', preferenceValueSchema),
    async (context) => {
      try {
        const key = context.req.param('key');
        const input = context.req.valid('json');
        await options.store.set(key, input.value);
        return context.json({ ok: true });
      } catch (error: unknown) {
        return uiPreferencesErrorResponse(context, error);
      }
    }
  );

  app.delete('/api/v1/ui-preferences/:key', async (context) => {
    try {
      await options.store.reset(context.req.param('key'));
      return context.json({ ok: true });
    } catch (error: unknown) {
      return uiPreferencesErrorResponse(context, error);
    }
  });

  // 2026-05-05 拍板：「恢复默认设置」一键把所有 UI 偏好重置为 schema.default。
  // last_opened_conversation_id 是运行时状态而不是用户偏好，强制保留，避免主人
  // 一点重置就被甩到空对话。
  app.post('/api/v1/ui-preferences/reset', async (context) => {
    try {
      const preserved = new Set<string>(PRESERVED_PREFERENCE_KEYS);
      const all = await options.store.getAll();
      for (const key of Object.keys(all)) {
        if (preserved.has(key)) continue;
        await options.store.reset(key);
      }
      const preferences = await options.store.getAll();
      return context.json({ ok: true, preferences });
    } catch (error: unknown) {
      return uiPreferencesErrorResponse(context, error);
    }
  });

  return app;
}

const PRESERVED_PREFERENCE_KEYS: readonly string[] = ['last_opened_conversation_id'];

function uiPreferencesErrorResponse(context: {
  json: (value: { ok: false; code: string; message: string }, status: 400 | 500) => Response;
}, error: unknown): Response {
  if (error instanceof LinnsyError && isUiPreferenceErrorCode(error.code)) {
    return context.json({
      ok: false,
      code: error.code,
      message: error.message
    }, 400);
  }

  const message = error instanceof Error ? error.message : 'unknown ui preferences error';
  return context.json({
    ok: false,
    code: 'LINNSY_UI_PREFERENCE_INTERNAL_ERROR',
    message
  }, 500);
}

function isUiPreferenceErrorCode(code: string): boolean {
  return code === UI_PREFERENCE_ROUTE_ERROR_CODES.KEY_UNKNOWN
    || code === UI_PREFERENCE_ROUTE_ERROR_CODES.VALUE_INVALID;
}
