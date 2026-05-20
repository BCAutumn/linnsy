import { describe, expect, test } from 'vitest';

import { LinnsyError } from '../../../../../../shared/errors.js';
import {
  createUiPreferencesRoutes,
  UI_PREFERENCE_ROUTE_ERROR_CODES,
  type UiPreferencesRoutesStorePort
} from '../ui-preferences-routes.js';

describe('ui preferences routes', () => {
  test('returns all UI preferences', async () => {
    const app = createUiPreferencesRoutes({
      store: uiPreferencesStore({
        getAll: () => Promise.resolve({ 'theme.mode': 'auto', language: 'zh-CN' })
      })
    });

    const response = await app.request('/api/v1/ui-preferences');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      preferences: { 'theme.mode': 'auto', language: 'zh-CN' }
    });
  });

  test('reads, writes, and resets one preference key', async () => {
    const calls: Array<{ key: string; value?: unknown; op: 'get' | 'set' | 'reset' }> = [];
    const app = createUiPreferencesRoutes({
      store: uiPreferencesStore({
        get(key) {
          calls.push({ op: 'get', key });
          return Promise.resolve('dark');
        },
        set(key, value) {
          calls.push({ op: 'set', key, value });
          return Promise.resolve();
        },
        reset(key) {
          calls.push({ op: 'reset', key });
          return Promise.resolve();
        }
      })
    });

    const getResponse = await app.request('/api/v1/ui-preferences/theme.mode');
    const putResponse = await app.request('/api/v1/ui-preferences/theme.mode', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'light' })
    });
    const deleteResponse = await app.request('/api/v1/ui-preferences/theme.mode', { method: 'DELETE' });

    await expect(getResponse.json()).resolves.toEqual({ ok: true, key: 'theme.mode', value: 'dark' });
    await expect(putResponse.json()).resolves.toEqual({ ok: true });
    await expect(deleteResponse.json()).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      { op: 'get', key: 'theme.mode' },
      { op: 'set', key: 'theme.mode', value: 'light' },
      { op: 'reset', key: 'theme.mode' }
    ]);
  });

  test('maps UI preference store validation errors to 400', async () => {
    const app = createUiPreferencesRoutes({
      store: uiPreferencesStore({
        get: () => Promise.reject(new LinnsyError(
          UI_PREFERENCE_ROUTE_ERROR_CODES.KEY_UNKNOWN,
          'unknown UI preference key unknown.key',
          false
        ))
      })
    });

    const response = await app.request('/api/v1/ui-preferences/unknown.key');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: UI_PREFERENCE_ROUTE_ERROR_CODES.KEY_UNKNOWN,
      message: 'unknown UI preference key unknown.key'
    });
  });
});

function uiPreferencesStore(overrides: Partial<UiPreferencesRoutesStorePort>): UiPreferencesRoutesStorePort {
  return {
    get: () => Promise.reject(new Error('not used')),
    getAll: () => Promise.resolve({}),
    set: () => Promise.reject(new Error('not used')),
    reset: () => Promise.reject(new Error('not used')),
    ...overrides
  };
}
