import { describe, expect, test, vi } from 'vitest';

import { LINNSY_ERROR_CODES } from '../../../../../shared/errors.js';
import { createObservabilityWebApp } from '../web-api.js';
import type { DashboardReadModelPort } from '../types.js';

describe('observability web API', () => {
  test('serves conversation and message read endpoints', async () => {
    const listConversations = vi.fn(() => Promise.resolve([
      {
        conversationId: 'conv_1',
        platform: 'desktop',
        chatType: 'private',
        chatId: 'window:main',
        title: 'Desktop',
        updatedAt: 20,
        lastActivityAt: 20
      }
    ]));
    const readMessages = vi.fn(() => Promise.resolve({
      messages: [{ messageId: 'msg_1', role: 'user', source: 'inbound', text: 'hi', createdAt: 21 }]
    }));
    const readModel = dashboardReadModel({
      listConversations,
      readMessages
    });
    const app = createObservabilityWebApp({
      readModel
    });

    const conversations = await app.request('/api/v1/conversations?limit=5', {
      headers: { Authorization: 'Bearer secret' }
    });
    const messages = await app.request('/api/v1/conversations/conv_1/messages?limit=20&cursor=msg_0', {
      headers: { Authorization: 'Bearer secret' }
    });

    expect(conversations.status).toBe(200);
    await expect(conversations.json()).resolves.toEqual({
      conversations: [expect.objectContaining({ conversationId: 'conv_1', title: 'Desktop' })]
    });
    expect(messages.status).toBe(200);
    await expect(messages.json()).resolves.toEqual({
      messages: [expect.objectContaining({ messageId: 'msg_1', text: 'hi' })]
    });
    expect(listConversations).toHaveBeenCalledWith({
      limit: 5,
      includeArchived: false
    });
    expect(readMessages).toHaveBeenCalledWith('conv_1', {
      limit: 20,
      cursor: 'msg_0'
    });
  });

  test('serves task list endpoint', async () => {
    const listTasks = vi.fn(() => Promise.resolve([
      { taskId: 'task_1', conversationId: 'conv_1', title: 'task', status: 'in_progress', updatedAt: 30 }
    ]));
    const readModel = dashboardReadModel({ listTasks });
    const app = createObservabilityWebApp({
      readModel
    });

    const response = await app.request('/api/v1/tasks?conversationId=conv_1&limit=10', {
      headers: { Authorization: 'Bearer secret' }
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      tasks: [expect.objectContaining({ taskId: 'task_1', status: 'in_progress' })]
    });
    expect(listTasks).toHaveBeenCalledWith({
      conversationId: 'conv_1',
      limit: 10
    });
  });

  test('creates a desktop conversation with bearer auth and rejects custom create fields', async () => {
    const createDesktopConversation = vi.fn(() => Promise.resolve({
      conversationId: 'conv_new',
      sessionKey: 'linnsy:main:desktop:private:window:branch:new',
      platform: 'desktop',
      chatType: 'private',
      chatId: 'window:branch:new',
      isNew: true,
      createdAt: 40,
      updatedAt: 40,
      lastActivityAt: 40
    }));
    const app = createObservabilityWebApp({
      readModel: dashboardReadModel({}),
      conversationCreator: { createDesktopConversation }
    });

    const created = await app.request('/api/v1/conversations', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret' }
    });
    const rejected = await app.request('/api/v1/conversations', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ platform: 'wechat' })
    });

    expect(created.status).toBe(201);
    const createdBody: unknown = await created.json();
    expect(isRecord(createdBody)).toBe(true);
    if (!isRecord(createdBody) || !isRecord(createdBody.conversation)) {
      throw new Error('Expected conversation create response to contain a conversation object.');
    }
    expect(createdBody.ok).toBe(true);
    expect(createdBody.conversation).toMatchObject({
      conversationId: 'conv_new',
      platform: 'desktop',
      chatType: 'private',
      chatId: 'window:branch:new'
    });
    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toMatchObject({
      ok: false,
      code: LINNSY_ERROR_CODES.CONVERSATION_CREATE_INVALID
    });
    expect(createDesktopConversation).toHaveBeenCalledTimes(1);
  });
});

function dashboardReadModel(overrides: Partial<DashboardReadModelPort>): DashboardReadModelPort {
  return {
    listConversations: () => Promise.resolve([]),
    readMessages: () => Promise.resolve({ messages: [] }),
    listTasks: () => Promise.resolve([]),
    pollEvents: () => Promise.resolve({ events: [] }),
    readEvents: () => Promise.resolve({ events: [] }),
    ...overrides
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
