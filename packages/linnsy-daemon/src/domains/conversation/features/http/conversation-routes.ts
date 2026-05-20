import { zValidator } from '@hono/zod-validator';
import { Hono, type Context } from 'hono';

import type { ConversationRecord } from '../../../../persistence/stores/conversation/conversation-store-port.js';
import {
  conversationResponseSchema,
  deleteConversationResponseSchema,
  patchConversationRequestSchema,
  type ConversationSummary
} from '../../../../shared/dto/index.js';
import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../shared/errors.js';
import type { ConversationManagementPort } from '../management/conversation-management-service.js';

export interface CreateConversationRoutesOptions {
  conversationManagement: ConversationManagementPort;
}

export function createConversationRoutes(options: CreateConversationRoutesOptions): Hono {
  const app = new Hono();

  app.patch(
    '/api/v1/conversations/:conversationId',
    zValidator('json', patchConversationRequestSchema),
    async (context) => {
      const conversationId = context.req.param('conversationId');
      const input = context.req.valid('json');
      try {
        let conversation: ConversationRecord | null = null;
        if (input.title !== undefined) {
          conversation = await options.conversationManagement.rename(conversationId, input.title);
        }
        if (input.pinned !== undefined) {
          conversation = await options.conversationManagement.setPinned(conversationId, input.pinned);
        }
        if (conversation === null) {
          return context.json({
            ok: false,
            code: LINNSY_ERROR_CODES.CONVERSATION_TITLE_INVALID,
            message: 'conversation patch must include title or pinned'
          }, 400);
        }
        return context.json(conversationResponseSchema.parse({
          ok: true,
          conversation: toConversationSummary(conversation)
        }));
      } catch (error: unknown) {
        return mapConversationError(context, error);
      }
    }
  );

  app.post('/api/v1/conversations/:conversationId/archive', async (context) => {
    const conversationId = context.req.param('conversationId');
    try {
      const conversation = await options.conversationManagement.archive(conversationId);
      return context.json(conversationResponseSchema.parse({
        ok: true,
        conversation: toConversationSummary(conversation)
      }));
    } catch (error: unknown) {
      return mapConversationError(context, error);
    }
  });

  app.delete('/api/v1/conversations/:conversationId', async (context) => {
    const conversationId = context.req.param('conversationId');
    try {
      await options.conversationManagement.permanentDelete(conversationId);
      return context.json(deleteConversationResponseSchema.parse({ ok: true, deleted: true, conversationId }));
    } catch (error: unknown) {
      return mapConversationError(context, error);
    }
  });

  return app;
}

function toConversationSummary(record: ConversationRecord): ConversationSummary {
  return {
    conversationId: record.conversationId,
    sessionKey: record.sessionKey,
    platform: record.platform,
    chatType: record.chatType,
    chatId: record.chatId,
    ...(record.userId === undefined ? {} : { userId: record.userId }),
    ...(record.title === undefined ? {} : { title: record.title }),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastActivityAt: record.lastActivityAt,
    ...(record.pinnedAt === undefined ? {} : { pinnedAt: record.pinnedAt }),
    ...(record.archivedAt === undefined ? {} : { archivedAt: record.archivedAt })
  };
}

function mapConversationError(context: Context, error: unknown): Response {
  if (!(error instanceof LinnsyError)) {
    throw error;
  }
  const status = readStatusForErrorCode(error.code);
  return context.json({
    ok: false,
    code: error.code,
    message: error.message
  }, status);
}

function readStatusForErrorCode(code: string): 400 | 404 | 409 {
  if (code === LINNSY_ERROR_CODES.CONVERSATION_NOT_FOUND) {
    return 404;
  }
  if (
    code === LINNSY_ERROR_CODES.CONVERSATION_DELETE_TERMINAL_BOUND
    || code === LINNSY_ERROR_CODES.CONVERSATION_ARCHIVE_TERMINAL_BOUND
    || code === LINNSY_ERROR_CODES.CONVERSATION_DELETE_HAS_ACTIVE_RUN
  ) {
    return 409;
  }
  return 400;
}
