import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import type { ObservabilityMcpToolRegistry } from './types.js';

export interface McpTransportLike {
  start(): Promise<void>;
  close(): Promise<void>;
}

export interface McpServerLike {
  registerTool(
    name: string,
    config: { description: string; inputSchema: Record<string, unknown> },
    callback: (args: Record<string, unknown>) => Promise<{
      content: Array<{ type: 'text'; text: string }>;
      structuredContent: Record<string, unknown>;
    }>
  ): unknown;
  connect(transport: McpTransportLike): Promise<void>;
  close(): Promise<void>;
}

export interface CreateObservabilityMcpServerOptions {
  tools: ObservabilityMcpToolRegistry;
  createServer?: () => McpServerLike;
  createStdioTransport?: () => McpTransportLike;
}

export interface StartObservabilityMcpServerOptions {
  transport: 'stdio';
}

export interface ObservabilityMcpServerPort {
  start(options: StartObservabilityMcpServerOptions): Promise<void>;
  stop(): Promise<void>;
}

export function createObservabilityMcpServer(
  options: CreateObservabilityMcpServerOptions
): ObservabilityMcpServerPort {
  const server = options.createServer?.() ?? createDefaultServer();
  const createStdioTransport = options.createStdioTransport ?? (() => new StdioServerTransport());
  let started = false;

  for (const tool of options.tools.list()) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema
      },
      async (args) => {
        const structuredContent = await options.tools.invoke(tool.name, args);
        return {
          content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
          structuredContent
        };
      }
    );
  }

  return {
    start: async (startOptions) => {
      if (started) {
        return;
      }
      startOptions.transport satisfies 'stdio';
      await server.connect(createStdioTransport());
      started = true;
    },
    stop: async () => {
      if (!started) {
        return;
      }
      await server.close();
      started = false;
    }
  };
}

function createDefaultServer(): McpServerLike {
  return new McpServer({
    name: 'linnsy-daemon',
    version: '0.0.0'
  }) as McpServerLike;
}
