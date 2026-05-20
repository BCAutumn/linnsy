import { createHash, randomUUID } from 'node:crypto';

import type {
  ConversationStorePort,
  ConversationRecord,
  ListConversationsFilter
} from '../../../../persistence/stores/conversation/conversation-store-port.js';
import type { ChatType, LinnsyMessage, Platform } from '../../../../shared/messaging.js';
import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../shared/errors.js';
import type { ClockPort } from '../../../../shared/ports.js';
import { systemClock } from '../../../../shared/ports.js';

import type { SessionListFilter, SessionLookup, SessionRouterPort } from './types.js';

const DESKTOP_SESSION_PLATFORM: Platform = 'desktop';

export interface BuildSessionKeyInput {
  platform: Platform;
  chatType: ChatType;
  chatId: string;
}

export function buildSessionKey(input: BuildSessionKeyInput): string {
  return `linnsy:main:${input.platform}:${input.chatType}:${input.chatId}`;
}

export interface CreateSessionRouterOptions {
  conversations: ConversationStorePort;
  clock?: ClockPort;
  conversationIdFactory?: (sessionKey: string) => string;
  desktopChatIdFactory?: () => string;
}

export function createSessionRouter(options: CreateSessionRouterOptions): SessionRouterPort {
  const clock = options.clock ?? systemClock;
  const idFactory = options.conversationIdFactory ?? defaultConversationIdFactory;
  const desktopChatIdFactory = options.desktopChatIdFactory ?? defaultDesktopChatIdFactory;
  const { conversations } = options;

  return {
    async resolve(message): Promise<SessionLookup> {
      const sessionKey = buildSessionKey({
        platform: message.platform,
        chatType: message.chatType,
        chatId: message.chatId
      });

      const existing = await conversations.findBySessionKey(sessionKey);
      const now = clock.now();

      if (existing !== null) {
        if (shouldRefreshUpdatedAt(existing, message, now)) {
          const mergedUserId = message.userId ?? existing.userId;
          const mergedMetadata = mergeMetadata(existing.metadata, message.metadata);
          const updated: ConversationRecord = {
            conversationId: existing.conversationId,
            sessionKey: existing.sessionKey,
            platform: existing.platform,
            chatType: existing.chatType,
            chatId: existing.chatId,
            createdAt: existing.createdAt,
            updatedAt: now,
            lastActivityAt: existing.lastActivityAt,
            ...(existing.title === undefined ? {} : { title: existing.title }),
            ...(existing.pinnedAt === undefined ? {} : { pinnedAt: existing.pinnedAt }),
            ...(existing.archivedAt === undefined ? {} : { archivedAt: existing.archivedAt }),
            ...(mergedUserId === undefined ? {} : { userId: mergedUserId }),
            ...(mergedMetadata === undefined ? {} : { metadata: mergedMetadata })
          };
          await conversations.upsert(updated);
          return toLookup(updated, false);
        }
        return toLookup(existing, false);
      }

      const conversationId = idFactory(sessionKey);
      const record: ConversationRecord = {
        conversationId,
        sessionKey,
        platform: message.platform,
        chatType: message.chatType,
        chatId: message.chatId,
        createdAt: now,
        updatedAt: now,
        lastActivityAt: now,
        ...(message.userId === undefined ? {} : { userId: message.userId }),
        ...(message.metadata === undefined ? {} : { metadata: message.metadata })
      };

      await conversations.upsert(record);
      return toLookup(record, true);
    },

    async resolveConversation(input): Promise<SessionLookup> {
      const existing = await conversations.get(input.conversationId);
      if (existing === null) {
        throw new LinnsyError(
          LINNSY_ERROR_CODES.SESSION_NOT_FOUND,
          `conversation ${input.conversationId} does not exist`,
          false
        );
      }

      const now = clock.now();
      const mergedUserId = input.userId ?? existing.userId;
      const mergedMetadata = mergeMetadata(existing.metadata, input.metadata);
      const updated: ConversationRecord = {
        conversationId: existing.conversationId,
        sessionKey: existing.sessionKey,
        platform: existing.platform,
        chatType: existing.chatType,
        chatId: existing.chatId,
        createdAt: existing.createdAt,
        updatedAt: now,
        lastActivityAt: existing.lastActivityAt,
        ...(existing.title === undefined ? {} : { title: existing.title }),
        ...(existing.pinnedAt === undefined ? {} : { pinnedAt: existing.pinnedAt }),
        ...(existing.archivedAt === undefined ? {} : { archivedAt: existing.archivedAt }),
        ...(mergedUserId === undefined ? {} : { userId: mergedUserId }),
        ...(mergedMetadata === undefined ? {} : { metadata: mergedMetadata })
      };
      await conversations.upsert(updated);
      return toLookup(updated, false);
    },

    async createDesktopConversation(): Promise<SessionLookup> {
      const now = clock.now();
      const chatId = desktopChatIdFactory();
      const sessionKey = buildSessionKey({
        platform: DESKTOP_SESSION_PLATFORM,
        chatType: 'private',
        chatId
      });
      const record: ConversationRecord = {
        conversationId: idFactory(sessionKey),
        sessionKey,
        platform: DESKTOP_SESSION_PLATFORM,
        chatType: 'private',
        chatId,
        createdAt: now,
        updatedAt: now,
        lastActivityAt: now,
        metadata: {
          createdBy: 'desktop-new-conversation'
        }
      };

      await conversations.upsert(record);
      return toLookup(record, true);
    },

    async setTitleIfMissing(conversationId, title): Promise<void> {
      const normalizedTitle = normalizeConversationTitle(title);
      if (normalizedTitle === null) {
        return;
      }
      const existing = await conversations.get(conversationId);
      if (existing === null) {
        throw new LinnsyError(
          LINNSY_ERROR_CODES.SESSION_NOT_FOUND,
          `conversation ${conversationId} does not exist`,
          false
        );
      }
      if (existing.title !== undefined && existing.title.trim().length > 0) {
        return;
      }
      await conversations.upsert({
        ...existing,
        title: normalizedTitle
      });
    },

    async archive(conversationId): Promise<void> {
      const archivedAt = clock.now();
      const archived = await conversations.archive(conversationId, archivedAt);
      if (!archived) {
        throw new LinnsyError(
          LINNSY_ERROR_CODES.SESSION_NOT_FOUND,
          `conversation ${conversationId} does not exist`,
          false
        );
      }
    },

    async list(filter?: SessionListFilter): Promise<SessionLookup[]> {
      const storeFilter: ListConversationsFilter = {
        ...(filter?.platform === undefined ? {} : { platform: String(filter.platform) }),
        ...(filter?.activeWithinMs === undefined ? {} : { activeWithinMs: filter.activeWithinMs }),
        ...(filter?.includeArchived === undefined ? {} : { includeArchived: filter.includeArchived }),
        ...(filter?.limit === undefined ? {} : { limit: filter.limit }),
        now: clock.now()
      };
      const records = await conversations.list(storeFilter);
      return records.map((record) => toLookup(record, false));
    }
  };
}

function defaultConversationIdFactory(sessionKey: string): string {
  const stable = createHash('sha1').update(sessionKey).digest('hex').slice(0, 24);
  return `conv_${stable}_${randomUUID().slice(0, 8)}`;
}

function defaultDesktopChatIdFactory(): string {
  return `window:branch:${randomUUID()}`;
}

function normalizeConversationTitle(title: string): string | null {
  const normalized = title.trim().replace(/\s+/g, ' ');
  return normalized.length === 0 ? null : normalized;
}

function shouldRefreshUpdatedAt(
  existing: ConversationRecord,
  message: Pick<LinnsyMessage, 'userId' | 'metadata'>,
  now: number
): boolean {
  if (existing.userId !== (message.userId ?? existing.userId)) {
    return true;
  }
  if (message.metadata !== undefined) {
    return true;
  }
  return now > existing.updatedAt;
}

function mergeMetadata(
  existing: Record<string, unknown> | undefined,
  incoming: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (incoming === undefined) {
    return existing;
  }
  if (existing === undefined) {
    return incoming;
  }
  return { ...existing, ...incoming };
}

function toLookup(record: ConversationRecord, isNew: boolean): SessionLookup {
  const lookup: SessionLookup = {
    conversationId: record.conversationId,
    sessionKey: record.sessionKey,
    platform: record.platform,
    chatType: record.chatType,
    chatId: record.chatId,
    isNew,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastActivityAt: record.lastActivityAt
  };
  if (record.archivedAt !== undefined) {
    lookup.archivedAt = record.archivedAt;
  }
  return lookup;
}
