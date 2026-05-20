import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { isRecord } from '../../../../../shared/json.js';

import type {
  DeferredOutboundMessage,
  DeferredOutboundPersistedRecord,
  OutboundQueuePort,
  DeferredOutboundStatus,
  WechatDeliveryMode,
  WechatGatewayStateStoreOptions
} from './types.js';

const DEFERRED_OUTBOUND_FILENAME = 'deferred-outbound.json';

export function createOutboundQueue(options: WechatGatewayStateStoreOptions): OutboundQueuePort {
  const filePath = join(options.stateDir, DEFERRED_OUTBOUND_FILENAME);
  // Phase 1 assumes a single gateway process owns this state directory.
  // We serialize in-process mutations and recover stale claimed records on restart.
  const runSerialized = createSerializedRunner();
  let startupRecoveryDone = false;

  return {
    async enqueue(input: DeferredOutboundMessage): Promise<void> {
      await runSerialized(async () => {
        const queued = await loadPersistedQueue();
        queued.push(toPersistedRecord(input, 'ready'));
        await writeDeferredOutbound(filePath, queued);
      });
    },

    async claimReadyForChat(chatId: string): Promise<DeferredOutboundMessage[]> {
      return runSerialized(async () => {
        const queued = await loadPersistedQueue();
        const claimed: DeferredOutboundMessage[] = [];
        const nextState = queued.map((message) => {
          if (message.chatId !== chatId || message.status !== 'ready') {
            return message;
          }

          const nextMessage = { ...message, status: 'claimed' } satisfies DeferredOutboundPersistedRecord;
          claimed.push(toDeferredOutboundMessage(nextMessage));
          return nextMessage;
        });

        await writeDeferredOutbound(filePath, nextState);
        return claimed;
      });
    },

    async markDelivered(deferredIds: string[]): Promise<void> {
      await runSerialized(async () => {
        const queued = await loadPersistedQueue();
        const deliveredIds = new Set(deferredIds);
        const remaining = queued.filter((message) => !deliveredIds.has(message.deferredId));
        await writeDeferredOutbound(filePath, remaining);
      });
    },

    async releaseClaimed(deferredIds: string[]): Promise<void> {
      await runSerialized(async () => {
        const queued = await loadPersistedQueue();
        const releasedIds = new Set(deferredIds);
        const nextState = queued.map((message) => {
          if (!releasedIds.has(message.deferredId) || message.status !== 'claimed') {
            return message;
          }

          return {
            ...message,
            status: 'ready'
          } satisfies DeferredOutboundPersistedRecord;
        });
        await writeDeferredOutbound(filePath, nextState);
      });
    },

    getSummary(): Promise<{ readyCount: number; claimedCount: number }> {
      return runSerialized(async () => {
        const queued = await loadPersistedQueue();
        let readyCount = 0;
        let claimedCount = 0;

        for (const message of queued) {
          if (message.status === 'ready') {
            readyCount += 1;
          } else {
            claimedCount += 1;
          }
        }

        return { readyCount, claimedCount };
      });
    },

    clear(): Promise<void> {
      return runSerialized(async () => {
        await rm(filePath, { force: true });
      });
    }
  };

  async function loadPersistedQueue(): Promise<DeferredOutboundPersistedRecord[]> {
    const queued = await readDeferredOutbound(filePath);
    if (startupRecoveryDone) {
      return queued;
    }

    startupRecoveryDone = true;
    const recovered = recoverClaimedMessages(queued);
    if (!recovered.changed) {
      return queued;
    }

    await writeDeferredOutbound(filePath, recovered.messages);
    return recovered.messages;
  }
}

async function readDeferredOutbound(filePath: string): Promise<DeferredOutboundPersistedRecord[]> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isDeferredOutboundState(parsed)) {
      throw new Error(`invalid deferred outbound state at ${filePath}`);
    }
    return parsed;
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return [];
    }
    throw error;
  }
}

async function writeDeferredOutbound(filePath: string, queued: DeferredOutboundPersistedRecord[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFile(filePath, `${JSON.stringify(queued, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function isDeferredOutboundState(value: unknown): value is DeferredOutboundPersistedRecord[] {
  return Array.isArray(value) && value.every((entry) => isDeferredOutboundMessage(entry));
}

function isDeferredOutboundMessage(value: unknown): value is DeferredOutboundPersistedRecord {
  return isRecord(value)
    && typeof value.deferredId === 'string'
    && typeof value.chatId === 'string'
    && typeof value.text === 'string'
    && isWechatDeliveryMode(value.deliveryMode)
    && typeof value.createdAt === 'number'
    && isDeferredOutboundStatus(value.status);
}

function isWechatDeliveryMode(value: unknown): value is WechatDeliveryMode {
  return value === 'reply' || value === 'proactive';
}

function isDeferredOutboundStatus(value: unknown): value is DeferredOutboundStatus {
  return value === 'ready' || value === 'claimed';
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function toPersistedRecord(
  message: DeferredOutboundMessage,
  status: DeferredOutboundStatus
): DeferredOutboundPersistedRecord {
  return {
    ...message,
    status
  };
}

function toDeferredOutboundMessage(message: DeferredOutboundPersistedRecord): DeferredOutboundMessage {
  return {
    deferredId: message.deferredId,
    chatId: message.chatId,
    text: message.text,
    deliveryMode: message.deliveryMode,
    createdAt: message.createdAt
  };
}

function recoverClaimedMessages(messages: DeferredOutboundPersistedRecord[]): {
  changed: boolean;
  messages: DeferredOutboundPersistedRecord[];
} {
  let changed = false;
  const recoveredMessages = messages.map((message) => {
    if (message.status !== 'claimed') {
      return message;
    }

    changed = true;
    return {
      ...message,
      status: 'ready'
    } satisfies DeferredOutboundPersistedRecord;
  });

  return {
    changed,
    messages: recoveredMessages
  };
}

function createSerializedRunner(): <T>(operation: () => Promise<T>) => Promise<T> {
  let pending = Promise.resolve();

  return async function runSerialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(operation);
    pending = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };
}
