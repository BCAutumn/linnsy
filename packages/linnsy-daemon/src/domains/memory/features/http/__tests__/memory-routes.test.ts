import { describe, expect, test } from 'vitest';

import { LinnsyError } from '../../../../../shared/errors.js';
import {
  MEMORY_ERROR_CODES,
  type MemoryItem,
  type MemoryListOptions,
  type MemoryProviderPort,
  type MemoryUpsertInput
} from '../../../persistence/memory-store-port.js';
import { createMemoryRoutes } from '../memory-routes.js';

describe('memory routes', () => {
  test('lists memory items with query filters', async () => {
    const calls: MemoryListOptions[] = [];
    const app = createMemoryRoutes({
      store: memoryStore({
        list(options) {
          calls.push(options ?? {});
          return Promise.resolve([memoryItem({ memoryId: 'mem_1' })]);
        }
      })
    });

    const response = await app.request('/api/v1/memory/items?query=%E5%A4%A9%E5%8F%B8&scope=owner_profile&limit=20');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      items: [memoryItem({ memoryId: 'mem_1' })]
    });
    expect(calls).toEqual([{ query: '天司', scope: 'owner_profile', limit: 20 }]);
  });

  test('previews the effective backend system prompt from registry and memory layers', async () => {
    const app = createMemoryRoutes({
      store: memoryStore({}),
      systemPromptPreview: () => Promise.resolve(systemPromptPreview())
    });

    const response = await app.request('/api/v1/memory/system-prompt-preview');

    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    if (!isSystemPromptPreviewResponse(body)) {
      throw new Error('system prompt preview response should be typed');
    }
    expect(body.ok).toBe(true);
    expect(body.preview.agentId).toBe('linnsy_main');
    expect(body.preview.role).toBe('system');
    expect(body.preview.assembledPrompt).toContain('System source from backend memory.');
    expect(body.preview.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'system_prompt', body: 'System source from backend memory.' }),
      expect.objectContaining({ scope: 'persona', body: 'Linnsy is the same secretary.' }),
      expect.objectContaining({ scope: 'long_term_memory', body: '主人常用 linnsy 项目。' })
    ]));
  });

  test('reports system prompt preview as unavailable when the runtime preview bridge is absent', async () => {
    const app = createMemoryRoutes({
      store: memoryStore({})
    });

    const response = await app.request('/api/v1/memory/system-prompt-preview');

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: 'LINNSY_MEMORY_SYSTEM_PROMPT_PREVIEW_UNAVAILABLE',
      message: 'system prompt preview is not available'
    });
  });

  test('creates, updates, and deletes memory items', async () => {
    const calls: Array<{ op: 'upsert'; input: MemoryUpsertInput } | { op: 'remove'; memoryId: string }> = [];
    let mutationCount = 0;
    const app = createMemoryRoutes({
      store: memoryStore({
        upsert(input) {
          calls.push({ op: 'upsert', input });
          return Promise.resolve(memoryItem({
            memoryId: input.memoryId ?? 'mem_new',
            scope: input.scope,
            body: input.body
          }));
        },
        remove(memoryId) {
          calls.push({ op: 'remove', memoryId });
          return Promise.resolve(true);
        }
      }),
      afterMutation() {
        mutationCount += 1;
      }
    });

    const createResponse = await app.request('/api/v1/memory/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'owner_profile',
        body: '主人希望被称呼为天司。',
        metadata: {
          builtin: true,
          source: 'linnsy_main.prompt',
          agentId: 'linnsy_main',
          enabled: true
        }
      })
    });
    const updateResponse = await app.request('/api/v1/memory/items/mem_1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'owner_profile',
        body: '主人希望回答直接。'
      })
    });
    const deleteResponse = await app.request('/api/v1/memory/items/mem_1', { method: 'DELETE' });

    expect(createResponse.status).toBe(201);
    await expect(updateResponse.json()).resolves.toMatchObject({
      ok: true,
      item: { memoryId: 'mem_1', body: '主人希望回答直接。' }
    });
    await expect(deleteResponse.json()).resolves.toEqual({ ok: true, removed: true });
    expect(calls).toEqual([
      {
        op: 'upsert',
        input: {
          scope: 'owner_profile',
          body: '主人希望被称呼为天司。',
          metadata: { enabled: true }
        }
      },
      {
        op: 'upsert',
        input: {
          memoryId: 'mem_1',
          scope: 'owner_profile',
          body: '主人希望回答直接。'
        }
      },
      { op: 'remove', memoryId: 'mem_1' }
    ]);
    expect(mutationCount).toBe(3);
  });

  test('maps memory store validation errors to 400', async () => {
    const app = createMemoryRoutes({
      store: memoryStore({
        upsert: () => Promise.reject(new LinnsyError(
          MEMORY_ERROR_CODES.ITEM_INVALID,
          'memory body must not be empty',
          false
        ))
      })
    });

    const response = await app.request('/api/v1/memory/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'owner_profile',
        body: '内容'
      })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: MEMORY_ERROR_CODES.ITEM_INVALID,
      message: 'memory body must not be empty'
    });
  });

  test('rejects invalid request bodies before touching the store', async () => {
    let touched = false;
    const app = createMemoryRoutes({
      store: memoryStore({
        upsert() {
          touched = true;
          return Promise.resolve(memoryItem({}));
        }
      })
    });

    const response = await app.request('/api/v1/memory/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: '缺字段' })
    });

    expect(response.status).toBe(400);
    expect(touched).toBe(false);
  });
});

function memoryStore(overrides: Partial<MemoryProviderPort>): MemoryProviderPort {
  return {
    list: () => Promise.resolve([]),
    recall: () => Promise.resolve([]),
    upsert: () => Promise.reject(new Error('not used')),
    remove: () => Promise.reject(new Error('not used')),
    ...overrides
  };
}

function memoryItem(overrides: Partial<MemoryItem>): MemoryItem {
  return {
    memoryId: 'mem_default',
    scope: 'owner_profile',
    body: '主人希望被称呼为天司。',
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides
  };
}

function isSystemPromptPreviewResponse(value: unknown): value is {
  ok: true;
  preview: SystemPromptPreviewFixture;
} {
  return typeof value === 'object'
    && value !== null
    && 'ok' in value
    && value.ok === true
    && 'preview' in value
    && isSystemPromptPreview(value.preview);
}

function isSystemPromptPreview(value: unknown): value is SystemPromptPreviewFixture {
  return typeof value === 'object'
    && value !== null
    && 'agentId' in value
    && typeof value.agentId === 'string'
    && 'role' in value
    && value.role === 'system'
    && 'assembledPrompt' in value
    && typeof value.assembledPrompt === 'string'
    && 'sections' in value
    && Array.isArray(value.sections);
}

interface SystemPromptPreviewFixture {
  agentId: string;
  role: 'system';
  assembledPrompt: string;
  sections: Array<{
    scope: string;
    body: string;
  }>;
}

function systemPromptPreview(): SystemPromptPreviewFixture {
  return {
    agentId: 'linnsy_main',
    role: 'system',
    assembledPrompt: [
      'System source from backend memory.',
      'Linnsy is the same secretary.',
      '主人常用 linnsy 项目。'
    ].join('\n'),
    sections: [
      { scope: 'system_prompt', body: 'System source from backend memory.' },
      { scope: 'persona', body: 'Linnsy is the same secretary.' },
      { scope: 'long_term_memory', body: '主人常用 linnsy 项目。' }
    ]
  };
}
