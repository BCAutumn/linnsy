import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../../../../../__tests__/harness/temp-home.js';
import { createOutboundQueue } from '../outbound-queue.js';
import type { DeferredOutboundPersistedRecord } from '../types.js';

describe('OutboundQueue', () => {
  test('claims deferred messages for one chat in FIFO order', async () => {
    const home = await createTempLinnsyHome();
    try {
      const stateDir = join(home, 'wechat-gateway');
      const queue = createOutboundQueue({ stateDir });

      await queue.enqueue({
        deferredId: 'deferred_1',
        chatId: 'wx_user_1',
        text: 'first message',
        deliveryMode: 'proactive',
        createdAt: 1_000
      });
      await queue.enqueue({
        deferredId: 'deferred_2',
        chatId: 'wx_user_1',
        text: 'second message',
        deliveryMode: 'proactive',
        createdAt: 2_000
      });

      await expect(queue.claimReadyForChat('wx_user_1')).resolves.toEqual([
        {
          deferredId: 'deferred_1',
          chatId: 'wx_user_1',
          text: 'first message',
          deliveryMode: 'proactive',
          createdAt: 1_000
        },
        {
          deferredId: 'deferred_2',
          chatId: 'wx_user_1',
          text: 'second message',
          deliveryMode: 'proactive',
          createdAt: 2_000
        }
      ]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('does not return claimed messages again before delivery is acknowledged', async () => {
    const home = await createTempLinnsyHome();
    try {
      const stateDir = join(home, 'wechat-gateway');
      const queue = createOutboundQueue({ stateDir });

      await queue.enqueue({
        deferredId: 'deferred_1',
        chatId: 'wx_user_1',
        text: 'message for chat 1',
        deliveryMode: 'reply',
        createdAt: 1_000
      });

      await expect(queue.claimReadyForChat('wx_user_1')).resolves.toEqual([
        {
          deferredId: 'deferred_1',
          chatId: 'wx_user_1',
          text: 'message for chat 1',
          deliveryMode: 'reply',
          createdAt: 1_000
        }
      ]);
      await expect(queue.claimReadyForChat('wx_user_1')).resolves.toEqual([]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('takes only the requested chat, deletes delivered items, and keeps other chats pending', async () => {
    const home = await createTempLinnsyHome();
    try {
      const stateDir = join(home, 'wechat-gateway');
      const queue = createOutboundQueue({ stateDir });

      await queue.enqueue({
        deferredId: 'deferred_1',
        chatId: 'wx_user_1',
        text: 'message for chat 1',
        deliveryMode: 'reply',
        createdAt: 1_000
      });
      await queue.enqueue({
        deferredId: 'deferred_2',
        chatId: 'wx_user_2',
        text: 'message for chat 2',
        deliveryMode: 'proactive',
        createdAt: 2_000
      });

      const claimed = await queue.claimReadyForChat('wx_user_1');
      expect(claimed).toEqual([
        {
          deferredId: 'deferred_1',
          chatId: 'wx_user_1',
          text: 'message for chat 1',
          deliveryMode: 'reply',
          createdAt: 1_000
        }
      ]);

      await queue.markDelivered(['deferred_1']);

      await expect(queue.claimReadyForChat('wx_user_1')).resolves.toEqual([]);
      await expect(queue.claimReadyForChat('wx_user_2')).resolves.toEqual([
        {
          deferredId: 'deferred_2',
          chatId: 'wx_user_2',
          text: 'message for chat 2',
          deliveryMode: 'proactive',
          createdAt: 2_000
        }
      ]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('releases claimed messages back to ready state after send failure', async () => {
    const home = await createTempLinnsyHome();
    try {
      const stateDir = join(home, 'wechat-gateway');
      const queue = createOutboundQueue({ stateDir });

      await queue.enqueue({
        deferredId: 'deferred_1',
        chatId: 'wx_user_1',
        text: 'persisted message',
        deliveryMode: 'proactive',
        createdAt: 1_000
      });

      await expect(queue.claimReadyForChat('wx_user_1')).resolves.toEqual([
        {
          deferredId: 'deferred_1',
          chatId: 'wx_user_1',
          text: 'persisted message',
          deliveryMode: 'proactive',
          createdAt: 1_000
        }
      ]);
      await queue.releaseClaimed(['deferred_1']);
      await expect(queue.claimReadyForChat('wx_user_1')).resolves.toEqual([
        {
          deferredId: 'deferred_1',
          chatId: 'wx_user_1',
          text: 'persisted message',
          deliveryMode: 'proactive',
          createdAt: 1_000
        }
      ]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('recovers previously claimed messages after re-instantiation before ack', async () => {
    const home = await createTempLinnsyHome();
    try {
      const stateDir = join(home, 'wechat-gateway');
      const queue = createOutboundQueue({ stateDir });

      await queue.enqueue({
        deferredId: 'deferred_1',
        chatId: 'wx_user_1',
        text: 'persisted message',
        deliveryMode: 'proactive',
        createdAt: 1_000
      });

      await expect(queue.claimReadyForChat('wx_user_1')).resolves.toEqual([
        {
          deferredId: 'deferred_1',
          chatId: 'wx_user_1',
          text: 'persisted message',
          deliveryMode: 'proactive',
          createdAt: 1_000
        }
      ]);

      const restartedQueue = createOutboundQueue({ stateDir });
      await expect(restartedQueue.claimReadyForChat('wx_user_1')).resolves.toEqual([
        {
          deferredId: 'deferred_1',
          chatId: 'wx_user_1',
          text: 'persisted message',
          deliveryMode: 'proactive',
          createdAt: 1_000
        }
      ]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('serializes concurrent enqueues and persists claim state fields to disk', async () => {
    const home = await createTempLinnsyHome();
    try {
      const stateDir = join(home, 'wechat-gateway');
      const queue = createOutboundQueue({ stateDir });

      await Promise.all([
        queue.enqueue({
          deferredId: 'deferred_1',
          chatId: 'wx_user_1',
          text: 'first message',
          deliveryMode: 'reply',
          createdAt: 1_000
        }),
        queue.enqueue({
          deferredId: 'deferred_2',
          chatId: 'wx_user_2',
          text: 'second message',
          deliveryMode: 'proactive',
          createdAt: 2_000
        })
      ]);

      await expect(queue.claimReadyForChat('wx_user_1')).resolves.toEqual([
        {
          deferredId: 'deferred_1',
          chatId: 'wx_user_1',
          text: 'first message',
          deliveryMode: 'reply',
          createdAt: 1_000
        }
      ]);

      const persisted = await readPersistedQueue(join(stateDir, 'deferred-outbound.json'));
      expect(persisted).toEqual([
        expect.objectContaining({
          deferredId: 'deferred_1',
          status: 'claimed'
        }),
        expect.objectContaining({
          deferredId: 'deferred_2',
          status: 'ready'
        })
      ]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('restores manually persisted claimed records as ready on restart', async () => {
    const home = await createTempLinnsyHome();
    try {
      const stateDir = join(home, 'wechat-gateway');
      const filePath = join(stateDir, 'deferred-outbound.json');
      await mkdir(stateDir, { recursive: true, mode: 0o700 });
      await writeFile(filePath, `${JSON.stringify([
        {
          deferredId: 'deferred_1',
          chatId: 'wx_user_1',
          text: 'manual claimed record',
          deliveryMode: 'proactive',
          createdAt: 1_000,
          status: 'claimed'
        }
      ] satisfies DeferredOutboundPersistedRecord[], null, 2)}\n`);

      const queue = createOutboundQueue({ stateDir });
      await expect(queue.claimReadyForChat('wx_user_1')).resolves.toEqual([
        {
          deferredId: 'deferred_1',
          chatId: 'wx_user_1',
          text: 'manual claimed record',
          deliveryMode: 'proactive',
          createdAt: 1_000
        }
      ]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('clears all deferred messages for account switching', async () => {
    const home = await createTempLinnsyHome();
    try {
      const stateDir = join(home, 'wechat-gateway');
      const queue = createOutboundQueue({ stateDir });

      await queue.enqueue({
        deferredId: 'deferred_1',
        chatId: 'wx_user_1',
        text: 'old account message',
        deliveryMode: 'proactive',
        createdAt: 1_000
      });
      await queue.clear();

      await expect(queue.getSummary()).resolves.toEqual({
        readyCount: 0,
        claimedCount: 0
      });
      const secondQueue = createOutboundQueue({ stateDir });
      await expect(secondQueue.claimReadyForChat('wx_user_1')).resolves.toEqual([]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

async function readPersistedQueue(filePath: string): Promise<DeferredOutboundPersistedRecord[]> {
  const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  if (!isPersistedQueue(parsed)) {
    throw new Error(`unexpected persisted queue state at ${filePath}`);
  }
  return parsed;
}

function isPersistedQueue(value: unknown): value is DeferredOutboundPersistedRecord[] {
  return Array.isArray(value) && value.every((entry) => isPersistedRecord(entry));
}

function isPersistedRecord(value: unknown): value is DeferredOutboundPersistedRecord {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && 'deferredId' in value
    && 'chatId' in value
    && 'text' in value
    && 'deliveryMode' in value
    && 'createdAt' in value
    && 'status' in value
    && typeof value.deferredId === 'string'
    && typeof value.chatId === 'string'
    && typeof value.text === 'string'
    && (value.deliveryMode === 'reply' || value.deliveryMode === 'proactive')
    && typeof value.createdAt === 'number'
    && (value.status === 'ready' || value.status === 'claimed');
}
