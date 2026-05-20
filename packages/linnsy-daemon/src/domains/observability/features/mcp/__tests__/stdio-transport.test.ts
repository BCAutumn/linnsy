import { describe, expect, test, vi } from 'vitest';

import { createObservabilityMcpServer } from '../mcp-server.js';
import { createObservabilityMcpTools } from '../tools.js';
import type { DashboardReadModelPort } from '../../dashboard/types.js';

describe('observability MCP stdio server', () => {
  test('connects the registered tools to an injected transport', async () => {
    const connect = vi.fn(() => Promise.resolve());
    const tools = createObservabilityMcpTools({
      readModel: dashboardReadModel({})
    });
    const server = createObservabilityMcpServer({
      tools,
      createServer: () => ({
        registerTool: vi.fn(),
        connect,
        close: vi.fn(() => Promise.resolve())
      })
    });

    await server.start({ transport: 'stdio' });
    await server.stop();

    expect(connect).toHaveBeenCalledTimes(1);
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
