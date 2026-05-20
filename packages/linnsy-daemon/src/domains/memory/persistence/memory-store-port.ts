export const MEMORY_ERROR_CODES = {
  ITEM_NOT_FOUND: 'LINNSY_MEMORY_ITEM_NOT_FOUND',
  ITEM_INVALID: 'LINNSY_MEMORY_ITEM_INVALID'
} as const;

export interface MemoryItem {
  memoryId: string;
  scope: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
  conversationId?: string;
  expiresAt?: number;
  metadata?: Record<string, unknown>;
}

export interface MemoryListOptions {
  query?: string;
  scope?: string;
  limit?: number;
  includeArchived?: boolean;
}

export interface MemoryUpsertInput {
  memoryId?: string;
  scope: string;
  body: string;
  conversationId?: string;
  expiresAt?: number;
  metadata?: Record<string, unknown>;
}

export interface MemoryProviderPort {
  list(options?: MemoryListOptions): Promise<MemoryItem[]>;
  recall(options?: MemoryListOptions): Promise<MemoryItem[]>;
  upsert(input: MemoryUpsertInput): Promise<MemoryItem>;
  remove(memoryId: string): Promise<boolean>;
  onPreCompress?(conversationId: string): Promise<void>;
}
