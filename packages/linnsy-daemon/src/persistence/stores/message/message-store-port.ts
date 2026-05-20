import type { ToolCall } from '@linnlabs/linnkit/ports';

import type { SendTarget } from '../../../shared/messaging.js';

export interface MessageRecord {
  messageId: string;
  conversationId: string;
  role: string;
  source: string;
  platform?: string;
  chatType?: string;
  chatId?: string;
  providerMessageId?: string;
  text?: string;
  attachments?: unknown[];
  toolCalls?: ToolCall[];
  toolResult?: Record<string, unknown>;
  replyToId?: string;
  runId?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface ListMessagesOptions {
  limit?: number;
  cursor?: string;
}

export interface MessageStorePort {
  insert(record: MessageRecord): Promise<void>;
  insertIfProviderMessageAbsent(record: MessageRecord): Promise<boolean>;
  get(messageId: string): Promise<MessageRecord | null>;
  findByProviderMessage(platform: string, providerMessageId: string): Promise<MessageRecord | null>;
  listByRunId(runId: string): Promise<MessageRecord[]>;
  findLatestInboundTarget(conversationId: string): Promise<SendTarget | null>;
  listByConversation(
    conversationId: string,
    options?: ListMessagesOptions
  ): Promise<{ messages: MessageRecord[]; nextCursor?: string }>;
  /**
   * Agent 上下文读取的是最近发生的消息窗口；返回值仍保持时间正序，方便上层直接交给 linnkit 做预算裁剪。
   */
  listRecentByConversation(
    conversationId: string,
    options?: Pick<ListMessagesOptions, 'limit'>
  ): Promise<MessageRecord[]>;
}
