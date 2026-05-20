import { describe, expect, test, vi } from 'vitest';

import { createObservabilityMcpTools } from '../tools.js';
import type { DashboardReadModelPort } from '../../dashboard/types.js';

describe('observability MCP tools', () => {
  test('exposes the WeChat bot API-compatible core tool names', () => {
    const tools = createObservabilityMcpTools({
      readModel: dashboardReadModel({})
    });

    expect(tools.list().map((tool) => tool.name)).toEqual([
      'conversations_list',
      'messages_read',
      'messages_send',
      'events_poll',
      'tasks_list'
    ]);
  });

  test('dispatches read tools through the dashboard read model', async () => {
    const listConversations = vi.fn(() => Promise.resolve([
      {
        conversationId: 'conv_1',
        platform: 'desktop',
        chatType: 'private',
        chatId: 'window:main',
        updatedAt: 20,
        lastActivityAt: 20
      }
    ]));
    const readMessages = vi.fn(() => Promise.resolve({
      messages: [{ messageId: 'msg_1', role: 'user', source: 'inbound', text: 'hello', createdAt: 21 }]
    }));
    const readModel = dashboardReadModel({ listConversations, readMessages });
    const tools = createObservabilityMcpTools({ readModel });

    await expect(tools.invoke('conversations_list', { limit: 3 })).resolves.toEqual({
      conversations: [expect.objectContaining({ conversationId: 'conv_1' })]
    });
    await expect(tools.invoke('messages_read', {
      conversationId: 'conv_1',
      limit: 10,
      cursor: 'msg_0'
    })).resolves.toEqual({
      messages: [expect.objectContaining({ messageId: 'msg_1' })]
    });
    expect(listConversations).toHaveBeenCalledWith({
      limit: 3,
      includeArchived: false
    });
    expect(readMessages).toHaveBeenCalledWith('conv_1', {
      limit: 10,
      cursor: 'msg_0'
    });
  });

  test('messages_send requires an injected ingress port', async () => {
    const tools = createObservabilityMcpTools({
      readModel: dashboardReadModel({})
    });

    await expect(tools.invoke('messages_send', {
      conversationId: 'conv_1',
      text: 'hello'
    })).resolves.toEqual({
      ok: false,
      code: 'message_ingress_unavailable'
    });
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
