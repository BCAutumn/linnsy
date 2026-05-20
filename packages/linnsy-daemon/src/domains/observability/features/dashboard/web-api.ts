import { Hono } from 'hono';

import { LINNSY_ERROR_CODES } from '../../../../shared/errors.js';
import {
  conversationEventsResponseSchema,
  createdConversationResponseSchema,
  listConversationsResponseSchema,
  messagesResponseSchema
} from '../../../../shared/dto/index.js';
import type { ListConversationsFilter } from '../../../../persistence/stores/conversation/conversation-store-port.js';
import type { ListMessagesOptions } from '../../../../persistence/stores/message/message-store-port.js';
import type { TaskListFilter } from '../../../task/definitions/task.js';
import type { ConversationCreatePort, DashboardConversationSummary, DashboardReadModelPort } from './types.js';
import type { SessionLookup } from '../../../conversation/features/session-routing/types.js';

export interface CreateObservabilityWebAppOptions {
  readModel: DashboardReadModelPort;
  conversationCreator?: ConversationCreatePort;
}

export function createObservabilityWebApp(options: CreateObservabilityWebAppOptions): Hono {
  const app = new Hono();

  app.get('/api/v1/conversations', async (context) => {
    const limit = parsePositiveInt(context.req.query('limit'));
    const includeArchived = context.req.query('includeArchived') === 'true';
    const filter: ListConversationsFilter = {
      includeArchived
    };
    if (limit !== undefined) {
      filter.limit = limit;
    }
    const conversations = await options.readModel.listConversations(filter);
    return context.json(listConversationsResponseSchema.parse({ conversations }));
  });

  app.post('/api/v1/conversations', async (context) => {
    if (options.conversationCreator === undefined) {
      return context.json({
        ok: false,
        code: LINNSY_ERROR_CODES.CONVERSATION_CREATE_INVALID,
        message: 'desktop conversation creation is not available'
      }, 400);
    }
    const bodyAllowed = await isEmptyJsonBody(context.req.raw);
    if (!bodyAllowed) {
      return context.json({
        ok: false,
        code: LINNSY_ERROR_CODES.CONVERSATION_CREATE_INVALID,
        message: 'desktop conversation creation does not accept custom fields'
      }, 400);
    }
    const conversation = await options.conversationCreator.createDesktopConversation();
    return context.json(createdConversationResponseSchema.parse({
      ok: true,
      conversation: toCreatedConversationSummary(conversation)
    }), 201);
  });

  app.get('/api/v1/conversations/:conversationId/messages', async (context) => {
    const limit = parsePositiveInt(context.req.query('limit'));
    const cursor = context.req.query('cursor');
    const messageOptions: ListMessagesOptions = {};
    if (limit !== undefined) {
      messageOptions.limit = limit;
    }
    if (cursor !== undefined) {
      messageOptions.cursor = cursor;
    }
    const page = await options.readModel.readMessages(context.req.param('conversationId'), messageOptions);
    return context.json(messagesResponseSchema.parse(page));
  });

  // 历史事件流（events 表）：与 /messages 端点平行——前者覆盖 user/assistant 文本气泡，
  // 后者覆盖工具调用 / 子 agent / 系统事件等"对话流元素"。前端 hydrate 时合并两者按时间线回放。
  app.get('/api/v1/conversations/:conversationId/events', async (context) => {
    const limit = parsePositiveInt(context.req.query('limit'));
    const sinceSeq = parsePositiveInt(context.req.query('sinceSeq'));
    const opts: { sinceSeq?: number; limit?: number } = {};
    if (limit !== undefined) opts.limit = limit;
    if (sinceSeq !== undefined) opts.sinceSeq = sinceSeq;
    const page = await options.readModel.readEvents(context.req.param('conversationId'), opts);
    return context.json(conversationEventsResponseSchema.parse(page));
  });

  app.get('/api/v1/tasks', async (context) => {
    const limit = parsePositiveInt(context.req.query('limit'));
    const conversationId = context.req.query('conversationId');
    const filter: TaskListFilter = {};
    if (limit !== undefined) {
      filter.limit = limit;
    }
    if (conversationId !== undefined) {
      filter.conversationId = conversationId;
    }
    const tasks = await options.readModel.listTasks(filter);
    return context.json({ tasks });
  });

  app.get('/api/v1/events', async (context) => {
    const limit = parsePositiveInt(context.req.query('limit'));
    const eventOptions: { since?: string; limit?: number } = {};
    const since = context.req.query('since');
    if (limit !== undefined) {
      eventOptions.limit = limit;
    }
    if (since !== undefined) {
      eventOptions.since = since;
    }
    const events = await options.readModel.pollEvents(eventOptions);
    return context.json(events);
  });

  return app;
}

async function isEmptyJsonBody(request: Request): Promise<boolean> {
  const body = await request.text();
  if (body.trim().length === 0) {
    return true;
  }
  try {
    const parsed: unknown = JSON.parse(body);
    return isPlainEmptyObject(parsed);
  } catch {
    return false;
  }
}

function isPlainEmptyObject(value: unknown): boolean {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.keys(value).length === 0;
}

function toCreatedConversationSummary(lookup: SessionLookup): DashboardConversationSummary {
  return {
    conversationId: lookup.conversationId,
    sessionKey: lookup.sessionKey,
    platform: lookup.platform,
    chatType: lookup.chatType,
    chatId: lookup.chatId,
    createdAt: lookup.createdAt,
    updatedAt: lookup.updatedAt,
    lastActivityAt: lookup.lastActivityAt
  };
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
