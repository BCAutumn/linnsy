import type { ConversationRecord } from '../../../../persistence/stores/conversation/conversation-store-port.js';
import type {
  ListMessagesOptions,
  MessageRecord
} from '../../../../persistence/stores/message/message-store-port.js';
import type { TaskListFilter, TaskRecord } from '../../../task/definitions/task.js';
import type { RuntimeEventEnvelope } from '../../definitions/runtime-events.js';
import type {
  DashboardConversationSummary,
  DashboardEvent,
  DashboardMessage,
  DashboardReadModelPort,
  DashboardReadModelPorts,
  DashboardTask
} from './types.js';

export function createDashboardReadModel(ports: DashboardReadModelPorts): DashboardReadModelPort {
  return new DashboardReadModel(ports);
}

class DashboardReadModel implements DashboardReadModelPort {
  public constructor(private readonly ports: DashboardReadModelPorts) {}

  public async listConversations(
    filter: Parameters<DashboardReadModelPort['listConversations']>[0] = {}
  ): Promise<DashboardConversationSummary[]> {
    const conversations = await this.ports.conversations.list(filter);
    return conversations.map(toConversationSummary);
  }

  public async readMessages(
    conversationId: string,
    options: ListMessagesOptions = {}
  ): Promise<{ messages: DashboardMessage[]; nextCursor?: string }> {
    const page = await this.ports.messages.listByConversation(conversationId, options);
    const result: { messages: DashboardMessage[]; nextCursor?: string } = {
      messages: page.messages.map(toDashboardMessage)
    };
    if (page.nextCursor !== undefined) {
      result.nextCursor = page.nextCursor;
    }
    return result;
  }

  public async listTasks(filter: TaskListFilter = {}): Promise<DashboardTask[]> {
    const tasks = await this.ports.tasks.list(filter);
    return tasks.map(toDashboardTask);
  }

  public pollEvents(options: { since?: string; limit?: number } = {}): Promise<{ events: DashboardEvent[]; nextCursor?: string }> {
    if (this.ports.events === undefined) {
      return Promise.resolve({ events: [] });
    }
    const page = this.ports.events.poll(options);
    // RuntimeEvent 与 DashboardEvent 共享 schema（DashboardEvent 只是 RuntimeEvent +
    // 可选 entityId），直接透传即可——避免对 discriminated union 做 spread 解构丢类型。
    return Promise.resolve({
      events: page.events,
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor })
    });
  }

  public readEvents(
    conversationId: string,
    options: { sinceSeq?: number; limit?: number } = {}
  ): Promise<{ events: RuntimeEventEnvelope[]; nextCursor?: string }> {
    if (this.ports.eventsHistory === undefined) {
      return Promise.resolve({ events: [] });
    }
    const page = this.ports.eventsHistory.listByConversation(conversationId, options);
    return Promise.resolve({
      events: page.events,
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor })
    });
  }
}

function toConversationSummary(record: ConversationRecord): DashboardConversationSummary {
  const summary: DashboardConversationSummary = {
    conversationId: record.conversationId,
    sessionKey: record.sessionKey,
    platform: record.platform,
    chatType: record.chatType,
    chatId: record.chatId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastActivityAt: record.lastActivityAt
  };
  if (record.userId !== undefined) {
    summary.userId = record.userId;
  }
  if (record.title !== undefined) {
    summary.title = record.title;
  }
  if (record.pinnedAt !== undefined) {
    summary.pinnedAt = record.pinnedAt;
  }
  if (record.archivedAt !== undefined) {
    summary.archivedAt = record.archivedAt;
  }
  return summary;
}

function toDashboardMessage(record: MessageRecord): DashboardMessage {
  const message: DashboardMessage = {
    messageId: record.messageId,
    conversationId: record.conversationId,
    role: record.role,
    source: record.source,
    createdAt: record.createdAt
  };
  if (record.platform !== undefined) {
    message.platform = record.platform;
  }
  if (record.text !== undefined) {
    message.text = record.text;
  }
  if (record.replyToId !== undefined) {
    message.replyToId = record.replyToId;
  }
  if (record.runId !== undefined) {
    message.runId = record.runId;
  }
  if (record.metadata !== undefined) {
    message.metadata = record.metadata;
  }
  return message;
}

function toDashboardTask(record: TaskRecord): DashboardTask {
  const task: DashboardTask = {
    taskId: record.taskId,
    conversationId: record.conversationId,
    title: record.title,
    status: record.status,
    kind: record.kind,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
  if (record.dueAt !== undefined) {
    task.dueAt = record.dueAt;
  }
  if (record.workspacePath !== undefined) {
    task.workspacePath = record.workspacePath;
  }
  return task;
}
