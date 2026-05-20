import { describe, expect, test } from 'vitest';

import type { LinnsyMessage, Platform } from '../../../../../shared/messaging.js';
import type { LoggerPort } from '../../../../../shared/ports.js';

import { createAuthorizationGuard } from '../authorization-guard.js';
import type { PairingStorePort } from '../types.js';

describe('createAuthorizationGuard', () => {
  test('allows by platform allow-all before consulting other layers', async () => {
    const pairingStore = createFakePairingStore({ authorized: true });
    const guard = createAuthorizationGuard({
      globalAllowAll: false,
      platformPolicies: {
        telegram: { allowAll: true, allowlist: [] }
      },
      pairingStore
    });

    await expect(guard.authorize(message({ platform: 'telegram', chatId: 'stranger' })))
      .resolves.toEqual({ allow: true, layer: 'platform_all' });
    expect(pairingStore.authorizedChecks).toBe(0);
  });

  test('allows by per-platform chat allowlist', async () => {
    const guard = createAuthorizationGuard({
      globalAllowAll: false,
      platformPolicies: {
        telegram: { allowAll: false, allowlist: ['chat_1'] }
      },
      pairingStore: createFakePairingStore({ authorized: false })
    });

    await expect(guard.authorize(message({ platform: 'telegram', chatId: 'chat_1' })))
      .resolves.toEqual({ allow: true, layer: 'allowlist' });
  });

  test('allows by consumed pairing grant before global allow-all', async () => {
    const guard = createAuthorizationGuard({
      globalAllowAll: true,
      platformPolicies: {
        telegram: { allowAll: false, allowlist: [] }
      },
      pairingStore: createFakePairingStore({ authorized: true })
    });

    await expect(guard.authorize(message({ platform: 'telegram', chatId: 'paired_chat' })))
      .resolves.toEqual({ allow: true, layer: 'pairing' });
  });

  test('allows by global allow-all after pairing misses', async () => {
    const guard = createAuthorizationGuard({
      globalAllowAll: true,
      platformPolicies: {},
      pairingStore: createFakePairingStore({ authorized: false })
    });

    await expect(guard.authorize(message({ platform: 'telegram', chatId: 'dev_chat' })))
      .resolves.toEqual({ allow: true, layer: 'global_all' });
  });

  test('denies by default and emits auth-denied telemetry metadata', async () => {
    const records: Array<{ message: string; metadata?: Record<string, unknown> }> = [];
    const logger: LoggerPort = {
      info: (entry, metadata) => {
        const record: { message: string; metadata?: Record<string, unknown> } = { message: entry };
        if (metadata !== undefined) {
          record.metadata = metadata;
        }
        records.push(record);
      },
      warn: () => {},
      error: () => {}
    };
    const guard = createAuthorizationGuard({
      globalAllowAll: false,
      platformPolicies: {
        telegram: { allowAll: false, allowlist: [] }
      },
      pairingStore: createFakePairingStore({ authorized: false }),
      logger
    });

    await expect(guard.authorize(message({ platform: 'telegram', chatId: 'stranger' })))
      .resolves.toEqual({ allow: false, reason: 'default_deny' });
    expect(records).toEqual([
      {
        message: 'authorization denied',
        metadata: {
          kind: 'LINNSY_AUTH_DENIED',
          platform: 'telegram',
          chatType: 'private',
          chatId: 'stranger',
          reason: 'default_deny'
        }
      }
    ]);
  });
});

function message(input: { platform: Platform; chatId: string }): LinnsyMessage {
  return {
    messageId: `msg_${input.chatId}`,
    platform: input.platform,
    chatType: 'private',
    chatId: input.chatId,
    userId: 'user_1',
    text: 'hello',
    receivedAt: 10
  };
}

function createFakePairingStore(input: { authorized: boolean }): PairingStorePort & {
  authorizedChecks: number;
} {
  return {
    authorizedChecks: 0,
    hasAuthorizedPairing() {
      this.authorizedChecks += 1;
      return Promise.resolve(input.authorized);
    },
    createPairing() {
      return Promise.reject(new Error('not used'));
    },
    consumePairingCode() {
      return Promise.reject(new Error('not used'));
    }
  };
}
