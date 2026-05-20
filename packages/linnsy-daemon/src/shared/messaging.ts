export type BuiltInPlatform = 'cli' | 'telegram' | 'wechat' | 'feishu' | 'web' | 'desktop';
export type Platform = BuiltInPlatform | (string & {});

export type ChatType = 'private' | 'group' | 'channel';

export interface LinnsyAttachment {
  kind: 'file' | 'image' | 'audio' | 'video' | (string & {});
  uri: string;
  mimeType?: string;
  byteSize?: number;
  filename?: string;
}

export interface LinnsyMessage {
  messageId: string;
  /** 由桌面 UI 或绑定服务指定的对话线；存在时优先于平台 chatId 路由。 */
  conversationId?: string;
  platform: Platform;
  chatType: ChatType;
  chatId: string;
  userId?: string;
  providerMessageId?: string;
  text?: string;
  attachments?: LinnsyAttachment[];
  receivedAt: number;
  metadata?: Record<string, unknown>;
}

export interface SendTarget {
  platform: Platform;
  chatType: ChatType;
  chatId: string;
  replyToProviderMessageId?: string;
}

export interface OutboundPayload {
  text?: string;
  attachments?: LinnsyAttachment[];
  hints?: { typingIndicator?: boolean; markdown?: boolean };
}
