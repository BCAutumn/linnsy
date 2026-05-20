import type {
  ConversationRecord,
  ListConversationsFilter
} from '../../../../persistence/stores/conversation/conversation-store-port.js';
import type {
  ListMessagesOptions,
  MessageRecord
} from '../../../../persistence/stores/message/message-store-port.js';
import type { TaskListFilter, TaskRecord } from '../../../task/definitions/task.js';
import type {
  RuntimeEventHubPort,
  RuntimeEventPollItem
} from '../event-hub/event-hub.js';
import type { RuntimeEventEnvelope } from '../../definitions/runtime-events.js';
import type { SessionLookup } from '../../../conversation/features/session-routing/types.js';

export interface ConversationReadPort {
  list(filter?: ListConversationsFilter): Promise<ConversationRecord[]>;
}

export interface ConversationCreatePort {
  createDesktopConversation(): Promise<SessionLookup>;
}

export interface MessageReadPort {
  listByConversation(
    conversationId: string,
    options?: ListMessagesOptions
  ): Promise<{ messages: MessageRecord[]; nextCursor?: string }>;
}

export interface TaskReadPort {
  list(filter?: TaskListFilter): Promise<TaskRecord[]>;
}

export interface DashboardReadModelPorts {
  conversations: ConversationReadPort;
  messages: MessageReadPort;
  tasks: TaskReadPort;
  // 实时态：内存 ring buffer（hub.poll），用于全局轮询。
  events?: RuntimeEventHubPort;
  // 历史态：SQLite events 表（按 conversation 持久化），用于前端 hydrate。
  eventsHistory?: EventsHistoryReadPort;
}

export interface EventsHistoryReadPort {
  listByConversation(
    conversationId: string,
    options?: { sinceSeq?: number; limit?: number }
  ): { events: RuntimeEventEnvelope[]; nextCursor?: string };
}

export interface DashboardConversationSummary {
  conversationId: string;
  sessionKey?: string;
  platform: string;
  chatType: string;
  chatId: string;
  userId?: string;
  title?: string;
  createdAt?: number;
  updatedAt: number;
  lastActivityAt: number;
  pinnedAt?: number;
  archivedAt?: number;
}

export interface DashboardMessage {
  messageId: string;
  conversationId?: string;
  role: string;
  source: string;
  platform?: string;
  text?: string;
  replyToId?: string;
  runId?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface DashboardTask {
  taskId: string;
  conversationId: string;
  title: string;
  status: string;
  kind?: string;
  dueAt?: number;
  workspacePath?: string;
  createdAt?: number;
  updatedAt: number;
}

// Dashboard 实时态事件：有持久化历史源时来自 RuntimeEventEnvelope；无历史源的测试/轻量运行来自 RuntimeEvent。
// 历史态使用独立 envelope 类型（payload 宽松），见 readEvents 返回类型。
export type DashboardEvent = RuntimeEventPollItem & { entityId?: string };

export interface DashboardReadModelPort {
  listConversations(filter?: ListConversationsFilter): Promise<DashboardConversationSummary[]>;
  readMessages(
    conversationId: string,
    options?: ListMessagesOptions
  ): Promise<{ messages: DashboardMessage[]; nextCursor?: string }>;
  listTasks(filter?: TaskListFilter): Promise<DashboardTask[]>;
  pollEvents(options?: { since?: string; limit?: number }): Promise<{ events: DashboardEvent[]; nextCursor?: string }>;
  // 历史事件 hydrate 入口：按 conversation 拉取持久化层的 events 表内容。
  // 返回 wire-level envelope（payload 宽松），消费端按 kind 收敛——与 `readMessages`
  // 平行：前者覆盖 user/assistant 文本气泡，后者覆盖工具调用 / 子 agent / 系统事件。
  readEvents(
    conversationId: string,
    options?: { sinceSeq?: number; limit?: number }
  ): Promise<{ events: RuntimeEventEnvelope[]; nextCursor?: string }>;
}
