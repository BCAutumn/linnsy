import type { DashboardReadModelPort } from '../dashboard/types.js';
import type { ListConversationsFilter } from '../../../../persistence/stores/conversation/conversation-store-port.js';
import type { ListMessagesOptions } from '../../../../persistence/stores/message/message-store-port.js';
import type { TaskListFilter } from '../../../task/definitions/task.js';
import type {
  MessageIngressPort,
  ObservabilityMcpTool,
  ObservabilityMcpToolRegistry
} from './types.js';

export interface CreateObservabilityMcpToolsOptions {
  readModel: DashboardReadModelPort;
  messageIngress?: MessageIngressPort;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<Record<string, unknown>>;

export function createObservabilityMcpTools(
  options: CreateObservabilityMcpToolsOptions
): ObservabilityMcpToolRegistry {
  const handlers = new Map<string, ToolHandler>();
  const tools: ObservabilityMcpTool[] = [
    {
      name: 'conversations_list',
      description: 'List Linnsy conversations for dashboard and MCP clients.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number' },
          includeArchived: { type: 'boolean' }
        }
      }
    },
    {
      name: 'messages_read',
      description: 'Read messages in a Linnsy conversation.',
      inputSchema: {
        type: 'object',
        required: ['conversationId'],
        properties: {
          conversationId: { type: 'string' },
          limit: { type: 'number' },
          cursor: { type: 'string' }
        }
      }
    },
    {
      name: 'messages_send',
      description: 'Send a user message into a Linnsy conversation.',
      inputSchema: {
        type: 'object',
        required: ['conversationId', 'text'],
        properties: {
          conversationId: { type: 'string' },
          text: { type: 'string' }
        }
      }
    },
    {
      name: 'events_poll',
      description: 'Poll observability events after an optional cursor.',
      inputSchema: {
        type: 'object',
        properties: {
          since: { type: 'string' },
          limit: { type: 'number' }
        }
      }
    },
    {
      name: 'tasks_list',
      description: 'List Linnsy tasks by conversation or status.',
      inputSchema: {
        type: 'object',
        properties: {
          conversationId: { type: 'string' },
          limit: { type: 'number' }
        }
      }
    }
  ];

  handlers.set('conversations_list', async (args) => ({
    conversations: await options.readModel.listConversations(readConversationFilter(args))
  }));
  handlers.set('messages_read', async (args) => ({
    ...(await options.readModel.readMessages(
      readRequiredString(args.conversationId, 'conversationId'),
      readMessageOptions(args)
    ))
  }));
  handlers.set('messages_send', async (args) => {
    if (options.messageIngress === undefined) {
      return { ok: false, code: 'message_ingress_unavailable' };
    }
    return options.messageIngress.send({
      conversationId: readRequiredString(args.conversationId, 'conversationId'),
      text: readRequiredString(args.text, 'text')
    });
  });
  handlers.set('events_poll', (args) => options.readModel.pollEvents(readEventOptions(args)));
  handlers.set('tasks_list', async (args) => ({
    tasks: await options.readModel.listTasks(readTaskFilter(args))
  }));

  return {
    list: () => tools,
    invoke: async (name, args) => {
      const handler = handlers.get(name);
      if (handler === undefined) {
        return { ok: false, code: 'mcp_tool_not_found', tool: name };
      }
      return handler(readObject(args));
    }
  };
}

function readConversationFilter(args: Record<string, unknown>): ListConversationsFilter {
  const filter: ListConversationsFilter = {
    includeArchived: readBoolean(args.includeArchived) ?? false
  };
  const limit = readNumber(args.limit);
  if (limit !== undefined) {
    filter.limit = limit;
  }
  return filter;
}

function readMessageOptions(args: Record<string, unknown>): ListMessagesOptions {
  const options: ListMessagesOptions = {};
  const limit = readNumber(args.limit);
  const cursor = readString(args.cursor);
  if (limit !== undefined) {
    options.limit = limit;
  }
  if (cursor !== undefined) {
    options.cursor = cursor;
  }
  return options;
}

function readTaskFilter(args: Record<string, unknown>): TaskListFilter {
  const filter: TaskListFilter = {};
  const conversationId = readString(args.conversationId);
  const limit = readNumber(args.limit);
  if (conversationId !== undefined) {
    filter.conversationId = conversationId;
  }
  if (limit !== undefined) {
    filter.limit = limit;
  }
  return filter;
}

function readEventOptions(args: Record<string, unknown>): { since?: string; limit?: number } {
  const options: { since?: string; limit?: number } = {};
  const since = readString(args.since);
  const limit = readNumber(args.limit);
  if (since !== undefined) {
    options.since = since;
  }
  if (limit !== undefined) {
    options.limit = limit;
  }
  return options;
}

function readObject(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }
  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readRequiredString(value: unknown, key: string): string {
  const parsed = readString(value);
  if (parsed === undefined) {
    throw new Error(`Missing required MCP argument: ${key}`);
  }
  return parsed;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}
