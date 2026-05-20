import { describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';

import { createTables } from '../../../../../persistence/schema/schema-provider.js';
import { SqliteMemoryStore } from '../../../persistence/sqlite-memory-store.js';
import { linnsyMainPrompt } from '../../../../agent-run/features/agents/linnsy-main/prompt.js';
import { ensureDefaultMemoryItems } from '../functions/default-memory-items.js';

describe('ensureDefaultMemoryItems', () => {
  test('seeds editable default context items once', async () => {
    const db = new Database(':memory:');
    createTables(db);
    const store = new SqliteMemoryStore(db, { now: () => 1_000 });

    try {
      await ensureDefaultMemoryItems(store, linnsyMainPrompt);
      await ensureDefaultMemoryItems(store, linnsyMainPrompt);

      const systemPromptItems = await store.list({ scope: 'system_prompt', limit: 10 });
      const personaItems = await store.list({ scope: 'persona', limit: 10 });
      const workStyleItems = await store.list({ scope: 'work_style', limit: 10 });
      const userPreferenceItems = await store.list({ scope: 'user_preference', limit: 10 });
      const longTermItems = await store.list({ scope: 'long_term_memory', limit: 10 });

      expect(systemPromptItems).toHaveLength(1);
      expect(systemPromptItems[0]).toMatchObject({
        memoryId: 'builtin:linnsy_main:system_prompt'
      });
      expect(systemPromptItems[0]?.body).toContain('You are Linnsy');
      expect(personaItems).toHaveLength(1);
      expect(workStyleItems).toHaveLength(1);
      expect(userPreferenceItems).toHaveLength(1);
      expect(longTermItems).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  test('removes obsolete builtin memory aliases and seeds canonical defaults', async () => {
    const db = new Database(':memory:');
    createTables(db);
    const store = new SqliteMemoryStore(db, { now: () => 1_000 });

    try {
      await store.upsert({
        memoryId: 'builtin:linnsy_main:owner_shaping',
        scope: 'owner_shaping',
        body: '主人喜欢直接回答。'
      });
      await store.upsert({
        memoryId: 'builtin:linnsy_main:setting',
        scope: 'setting',
        body: '重要事项需要主动汇报。'
      });

      await ensureDefaultMemoryItems(store, linnsyMainPrompt);

      await expect(store.list({ scope: 'owner_shaping' })).resolves.toEqual([]);
      await expect(store.list({ scope: 'setting' })).resolves.toEqual([]);
      const userPreferences = await store.list({ scope: 'user_preference' });
      const workStyles = await store.list({ scope: 'work_style' });
      expect(userPreferences).toEqual([
        expect.objectContaining({ memoryId: 'builtin:linnsy_main:user_preference' })
      ]);
      expect(workStyles).toEqual([
        expect.objectContaining({
          memoryId: 'builtin:linnsy_main:work_style',
          body: '这里记录 Linnsy 做事时长期遵守的工作方式，例如主动程度、汇报边界、回复习惯和协作节奏。'
        })
      ]);
    } finally {
      db.close();
    }
  });

  test('removes legacy time template from builtin editable system prompt', async () => {
    const db = new Database(':memory:');
    createTables(db);
    const store = new SqliteMemoryStore(db, { now: () => 1_000 });

    try {
      await store.upsert({
        memoryId: 'builtin:linnsy_main:system_prompt',
        scope: 'system_prompt',
        body: [
          'You are Linnsy.',
          '',
          'Current time:',
          '- ISO: {{now.iso}}',
          '- Local: {{now.local}}',
          '- Timezone: {{now.timezone}}',
          '',
          'Speak Chinese by default.'
        ].join('\n'),
        metadata: { builtin: true }
      });

      await ensureDefaultMemoryItems(store, linnsyMainPrompt);

      const systemPromptItems = await store.list({ scope: 'system_prompt', limit: 10 });
      expect(systemPromptItems[0]?.body).not.toContain('{{now.');
      expect(systemPromptItems[0]?.body).toBe(linnsyMainPrompt);
      expect(systemPromptItems[0]?.body).toContain('Speak Chinese by default when the owner speaks Chinese.');
    } finally {
      db.close();
    }
  });

  test('keeps code-sourced builtin system prompt aligned with the current main prompt', async () => {
    const db = new Database(':memory:');
    createTables(db);
    const store = new SqliteMemoryStore(db, { now: () => 1_000 });

    try {
      await store.upsert({
        memoryId: 'builtin:linnsy_main:system_prompt',
        scope: 'system_prompt',
        body: 'You are Linnsy, the old prompt without Codex rules.',
        metadata: {
          builtin: true,
          agentId: 'linnsy_main',
          source: 'linnsy_main.prompt'
        }
      });

      await ensureDefaultMemoryItems(store, linnsyMainPrompt);

      const systemPromptItems = await store.list({ scope: 'system_prompt', limit: 10 });
      expect(systemPromptItems[0]?.body).toBe(linnsyMainPrompt);
      expect(systemPromptItems[0]?.body).toContain('When delegating to Codex');
    } finally {
      db.close();
    }
  });

  test('migrates legacy builtin system prompt even when the source marker is missing', async () => {
    const db = new Database(':memory:');
    createTables(db);
    const store = new SqliteMemoryStore(db, { now: () => 1_000 });

    try {
      await store.upsert({
        memoryId: 'builtin:linnsy_main:system_prompt',
        scope: 'system_prompt',
        body: 'You are Linnsy, the stale builtin prompt before source metadata.',
        metadata: {
          builtin: true,
          agentId: 'linnsy_main'
        }
      });

      await ensureDefaultMemoryItems(store, linnsyMainPrompt);

      const systemPromptItems = await store.list({ scope: 'system_prompt', limit: 10 });
      expect(systemPromptItems[0]?.body).toBe(linnsyMainPrompt);
      expect(systemPromptItems[0]?.body).toContain('Never guess or invent the Codex locator');
    } finally {
      db.close();
    }
  });

  test('migrates stale default system prompt records that lost builtin metadata during development', async () => {
    const db = new Database(':memory:');
    createTables(db);
    const store = new SqliteMemoryStore(db, { now: () => 1_000 });

    try {
      await store.upsert({
        memoryId: 'builtin:linnsy_main:system_prompt',
        scope: 'system_prompt',
        body: 'You are Linnsy, the stale default prompt that lost metadata.',
        metadata: {}
      });

      await ensureDefaultMemoryItems(store, linnsyMainPrompt);

      const systemPromptItems = await store.list({ scope: 'system_prompt', limit: 10 });
      expect(systemPromptItems[0]?.body).toBe(linnsyMainPrompt);
      expect(systemPromptItems[0]?.body).toContain('When delegating to Codex');
    } finally {
      db.close();
    }
  });

  test('resets the default system prompt id to the backend source even if metadata looks custom', async () => {
    const db = new Database(':memory:');
    createTables(db);
    const store = new SqliteMemoryStore(db, { now: () => 1_000 });

    try {
      await store.upsert({
        memoryId: 'builtin:linnsy_main:system_prompt',
        scope: 'system_prompt',
        body: '主人手动改过的系统提示词。',
        metadata: { enabled: true }
      });

      await ensureDefaultMemoryItems(store, linnsyMainPrompt);

      const systemPromptItems = await store.list({ scope: 'system_prompt', limit: 10 });
      expect(systemPromptItems[0]?.body).toBe(linnsyMainPrompt);
    } finally {
      db.close();
    }
  });

  test('resets all builtin default ids to the backend source', async () => {
    const db = new Database(':memory:');
    createTables(db);
    const store = new SqliteMemoryStore(db, { now: () => 1_000 });

    try {
      await store.upsert({
        memoryId: 'builtin:linnsy_main:persona',
        scope: 'persona',
        body: '开发期旧人设。',
        metadata: { enabled: true }
      });
      await store.upsert({
        memoryId: 'builtin:linnsy_main:work_style',
        scope: 'work_style',
        body: '这里记录 Linnsy 后续需要长期遵守的工作设定；工具权限仍由工具管理和审批配置控制。',
        metadata: { enabled: true }
      });
      await store.upsert({
        memoryId: 'builtin:linnsy_main:user_preference',
        scope: 'user_preference',
        body: '开发期旧偏好。',
        metadata: { enabled: true }
      });
      await store.upsert({
        memoryId: 'builtin:linnsy_main:long_term_memory',
        scope: 'long_term_memory',
        body: '开发期旧长期记忆。',
        metadata: { enabled: true }
      });

      await ensureDefaultMemoryItems(store, linnsyMainPrompt);

      const personaItems = await store.list({ scope: 'persona', limit: 10 });
      const workStyleItems = await store.list({ scope: 'work_style', limit: 10 });
      const userPreferenceItems = await store.list({ scope: 'user_preference', limit: 10 });
      const longTermItems = await store.list({ scope: 'long_term_memory', limit: 10 });
      expect(personaItems[0]?.body).toBe('Linnsy 是常驻在主人电脑上的个人 AI 秘书，需要像同一个人一样保持连续性。');
      expect(workStyleItems[0]?.body).toBe('这里记录 Linnsy 做事时长期遵守的工作方式，例如主动程度、汇报边界、回复习惯和协作节奏。');
      expect(userPreferenceItems[0]?.body).toBe('这里记录主人明确说过的偏好、称呼、沟通风格、工作习惯和已经纠正过的行为。');
      expect(longTermItems[0]?.body).toBe('这里放稳定的长期事实，例如主人是谁、重要项目、长期合作关系、固定日程、长期偏好。');
    } finally {
      db.close();
    }
  });
});
