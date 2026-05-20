import { describe, expect, test, vi } from 'vitest';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../shared/errors.js';
import type { ConversationManagementPort } from '../../management/conversation-management-service.js';
import { createConversationRoutes } from '../conversation-routes.js';

describe('conversation routes', () => {
  test('patches rename and pin in order', async () => {
    const calls: string[] = [];
    const app = createConversationRoutes({
      conversationManagement: conversationManagement({
        rename: (conversationId, title) => {
          calls.push(`rename:${conversationId}:${title ?? ''}`);
          return Promise.resolve(conversationRecord({
            conversationId,
            ...(title === null ? {} : { title })
          }));
        },
        setPinned: (conversationId, pinned) => {
          calls.push(`pin:${conversationId}:${String(pinned)}`);
          return Promise.resolve(conversationRecord({
            conversationId,
            ...(pinned ? { pinnedAt: 20 } : {})
          }));
        }
      })
    });

    const response = await app.request('/api/v1/conversations/conv_1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Pinned name', pinned: true })
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      conversation: {
        conversationId: 'conv_1',
        pinnedAt: 20
      }
    });
    expect(calls).toEqual(['rename:conv_1:Pinned name', 'pin:conv_1:true']);
  });

  test('archives and deletes conversations', async () => {
    const archive = vi.fn<ConversationManagementPort['archive']>((conversationId) => Promise.resolve(
      conversationRecord({ conversationId, archivedAt: 30 })
    ));
    const permanentDelete = vi.fn<ConversationManagementPort['permanentDelete']>(() => Promise.resolve());
    const app = createConversationRoutes({
      conversationManagement: conversationManagement({ archive, permanentDelete })
    });

    const archiveResponse = await app.request('/api/v1/conversations/conv_1/archive', { method: 'POST' });
    const deleteResponse = await app.request('/api/v1/conversations/conv_1', { method: 'DELETE' });

    expect(archiveResponse.status).toBe(200);
    await expect(archiveResponse.json()).resolves.toMatchObject({
      ok: true,
      conversation: { conversationId: 'conv_1', archivedAt: 30 }
    });
    expect(deleteResponse.status).toBe(200);
    await expect(deleteResponse.json()).resolves.toEqual({
      ok: true,
      deleted: true,
      conversationId: 'conv_1'
    });
  });

  test('maps not found and active work errors to HTTP statuses', async () => {
    const app = createConversationRoutes({
      conversationManagement: conversationManagement({
        rename: () => Promise.reject(new LinnsyError(
          LINNSY_ERROR_CODES.CONVERSATION_NOT_FOUND,
          'missing',
          false
        )),
        permanentDelete: () => Promise.reject(new LinnsyError(
          LINNSY_ERROR_CODES.CONVERSATION_DELETE_HAS_ACTIVE_RUN,
          'active',
          false
        ))
      })
    });

    const missingResponse = await app.request('/api/v1/conversations/missing', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Name' })
    });
    const activeResponse = await app.request('/api/v1/conversations/conv_1', { method: 'DELETE' });

    expect(missingResponse.status).toBe(404);
    await expect(missingResponse.json()).resolves.toMatchObject({
      ok: false,
      code: LINNSY_ERROR_CODES.CONVERSATION_NOT_FOUND
    });
    expect(activeResponse.status).toBe(409);
    await expect(activeResponse.json()).resolves.toMatchObject({
      ok: false,
      code: LINNSY_ERROR_CODES.CONVERSATION_DELETE_HAS_ACTIVE_RUN
    });
  });
});

function conversationManagement(
  overrides: Partial<ConversationManagementPort>
): ConversationManagementPort {
  return {
    rename: () => Promise.resolve(conversationRecord({ conversationId: 'conv_default' })),
    setPinned: () => Promise.resolve(conversationRecord({ conversationId: 'conv_default' })),
    archive: () => Promise.resolve(conversationRecord({ conversationId: 'conv_default' })),
    permanentDelete: () => Promise.resolve(),
    ...overrides
  };
}

function conversationRecord(input: {
  conversationId: string;
  title?: string;
  pinnedAt?: number;
  archivedAt?: number;
}) {
  return {
    conversationId: input.conversationId,
    sessionKey: `linnsy:main:desktop:private:${input.conversationId}`,
    platform: 'desktop',
    chatType: 'private',
    chatId: input.conversationId,
    createdAt: 1,
    updatedAt: 2,
    lastActivityAt: 1,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.pinnedAt === undefined ? {} : { pinnedAt: input.pinnedAt }),
    ...(input.archivedAt === undefined ? {} : { archivedAt: input.archivedAt })
  };
}
