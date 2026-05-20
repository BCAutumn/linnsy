export interface ConversationRecord {
  conversationId: string;
  sessionKey: string;
  platform: string;
  chatType: string;
  chatId: string;
  userId?: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
  pinnedAt?: number;
  archivedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface ListConversationsFilter {
  platform?: string;
  activeWithinMs?: number;
  includeArchived?: boolean;
  limit?: number;
  now?: number;
}

export type ConversationUpsertInput = Omit<ConversationRecord, 'lastActivityAt'> & {
  lastActivityAt?: number;
};

export interface ConversationPermanentDeleteOptions {
  activeRunStatuses: readonly string[];
  activeTaskStatuses: readonly string[];
}

export type ConversationPermanentDeleteResult =
  | { status: 'deleted' }
  | { status: 'not_found' }
  | { status: 'has_active_work' };

export interface ConversationStorePort {
  upsert(record: ConversationUpsertInput): Promise<void>;
  get(conversationId: string): Promise<ConversationRecord | null>;
  findBySessionKey(sessionKey: string): Promise<ConversationRecord | null>;
  rename(conversationId: string, title: string | null, updatedAt: number): Promise<boolean>;
  setPinned(conversationId: string, pinnedAt: number | null, updatedAt: number): Promise<boolean>;
  archive(conversationId: string, archivedAt: number): Promise<boolean>;
  unarchive(conversationId: string, updatedAt: number): Promise<boolean>;
  markActivity(conversationId: string, activityAt: number): boolean;
  purge(conversationId: string): Promise<boolean>;
  permanentDeleteShortTermData(
    conversationId: string,
    options: ConversationPermanentDeleteOptions
  ): Promise<ConversationPermanentDeleteResult>;
  list(filter?: ListConversationsFilter): Promise<ConversationRecord[]>;
}
