import type { LinnsyMessage, Platform } from '../../../../shared/messaging.js';

export interface SessionLookup {
  conversationId: string;
  sessionKey: string;
  platform: string;
  chatType: string;
  chatId: string;
  isNew: boolean;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
  archivedAt?: number;
}

export interface SessionListFilter {
  platform?: Platform;
  activeWithinMs?: number;
  includeArchived?: boolean;
  limit?: number;
}

export interface SessionRouterPort {
  resolve(message: Pick<LinnsyMessage, 'platform' | 'chatType' | 'chatId' | 'userId' | 'metadata'>): Promise<SessionLookup>;
  resolveConversation(input: { conversationId: string; userId?: string; metadata?: Record<string, unknown> }): Promise<SessionLookup>;
  createDesktopConversation(): Promise<SessionLookup>;
  setTitleIfMissing(conversationId: string, title: string): Promise<void>;
  archive(conversationId: string): Promise<void>;
  list(filter?: SessionListFilter): Promise<SessionLookup[]>;
}
