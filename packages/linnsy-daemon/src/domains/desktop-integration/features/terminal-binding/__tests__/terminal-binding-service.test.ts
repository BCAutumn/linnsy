import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../../../../__tests__/harness/temp-home.js';
import { createTables } from '../../../../../persistence/schema/schema-provider.js';
import { SqliteConversationStore } from '../../../../../persistence/stores/conversation/sqlite-conversation-store.js';
import { SqliteTerminalBindingStore } from '../../../persistence/terminal-binding/sqlite-terminal-binding-store.js';
import type { ClockPort } from '../../../../../shared/ports.js';
import { createSessionRouter } from '../../../../conversation/features/session-routing/session-router.js';
import { createTerminalBindingService } from '../terminal-binding-service.js';

describe('TerminalBindingService', () => {
  test('ensures the mobile terminal is bound to the default desktop conversation', async () => {
    const fixture = await createFixture(1_000);
    try {
      const binding = await fixture.service.ensureDefaultBinding();

      expect(binding).toMatchObject({
        terminalId: 'mobile',
        conversationId: 'id_linnsy:main:desktop:private:window:main',
        updatedAt: 1_000,
        updatedBy: 'system-default'
      });
      await expect(fixture.conversations.get(binding.conversationId)).resolves.toMatchObject({
        platform: 'desktop',
        chatType: 'private',
        chatId: 'window:main'
      });
    } finally {
      await fixture.cleanup();
    }
  });

  test('routes mobile inbound messages to the bound conversation without using the real phone chat id as session', async () => {
    const fixture = await createFixture(1_000);
    try {
      const desktopConversation = await fixture.router.createDesktopConversation();
      await fixture.service.bindToConversation(desktopConversation.conversationId, 'test');

      const session = await fixture.service.resolveInboundSession({
        messageId: 'wx_1',
        platform: 'wechat',
        chatType: 'private',
        chatId: 'real_wechat_user',
        text: 'hi',
        receivedAt: 2_000
      });

      expect(session?.conversationId).toBe(desktopConversation.conversationId);
      await expect(fixture.conversations.findBySessionKey('linnsy:main:wechat:private:real_wechat_user'))
        .resolves.toBeNull();
    } finally {
      await fixture.cleanup();
    }
  });
});

async function createFixture(initialNow: number): Promise<{
  conversations: SqliteConversationStore;
  router: ReturnType<typeof createSessionRouter>;
  service: ReturnType<typeof createTerminalBindingService>;
  cleanup(): Promise<void>;
}> {
  const home = await createTempLinnsyHome();
  const db = new Database(join(home, 'state.db'));
  createTables(db);
  const conversations = new SqliteConversationStore(db);
  const bindings = new SqliteTerminalBindingStore(db);
  const clock: ClockPort = { now: () => initialNow };
  const router = createSessionRouter({
    conversations,
    clock,
    conversationIdFactory: (sessionKey) => `id_${sessionKey}`,
    desktopChatIdFactory: () => 'window:branch:test'
  });
  const service = createTerminalBindingService({
    bindings,
    conversations,
    sessionRouter: router,
    clock
  });
  return {
    conversations,
    router,
    service,
    cleanup: async () => {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  };
}
