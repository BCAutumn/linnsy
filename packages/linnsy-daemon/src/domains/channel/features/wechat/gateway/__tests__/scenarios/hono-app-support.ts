import { EventEmitter } from 'node:events';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { vi } from 'vitest';
import { createTempLinnsyHome } from '../../../../../../../../__tests__/harness/temp-home.js';
import { createContextTokenStore } from '../../context-token-store.js';
import type {
  WechatBotApiPort,
  WechatBotApiGetUpdatesResult,
  WechatBotApiUpdate
} from '../../wechat-bot-api-client.js';
import { createWechatGatewayApp } from '../../hono-app.js';
import { createWechatGatewayRunner, type CloseableServer } from '../../runner.js';
import { createOutboundQueue } from '../../outbound-queue.js';
import { createWechatGatewayStatusTracker } from '../../gateway-status.js';


export class FakeCloseableServer extends EventEmitter implements CloseableServer {
  readonly close = vi.fn((callback?: () => void) => {
    callback?.();
  });

  emitError(error: Error): void {
    this.emit('error', error);
  }
}

export function createFakeWechatBotApiClient(options?: {
  updates?: WechatBotApiUpdate[];
  nextCursor?: string;
  sendError?: Error;
}): WechatBotApiPort & {
  getUpdatesCalls: number;
  commitCursorCalls: string[];
  sendCalls: Array<{ toUserId: string; text: string; contextToken: string }>;
} {
  const updates = options?.updates ?? [];
  const nextCursor = options?.nextCursor ?? 'cursor_after_batch_1';
  const sendCalls: Array<{ toUserId: string; text: string; contextToken: string }> = [];
  const commitCursorCalls: string[] = [];
  const client: WechatBotApiPort & {
    getUpdatesCalls: number;
    commitCursorCalls: string[];
    sendCalls: Array<{ toUserId: string; text: string; contextToken: string }>;
  } = {
    getUpdatesCalls: 0,
    commitCursorCalls,
    sendCalls,
    getUpdates(): Promise<WechatBotApiGetUpdatesResult> {
      client.getUpdatesCalls += 1;
      return Promise.resolve({
        updates,
        nextCursor
      });
    },
    commitCursor(nextCursorValue): Promise<void> {
      commitCursorCalls.push(nextCursorValue);
      return Promise.resolve();
    },
    sendMessage(input): Promise<void> {
      sendCalls.push(input);
      if (options?.sendError !== undefined) {
        return Promise.reject(options.sendError);
      }
      return Promise.resolve();
    }
  };

  return client;
}

export function inMemoryTokenStore(): {
  save(input: { chatId: string; token: string }): Promise<void>;
  get(chatId: string): Promise<{ chatId: string; token: string } | null>;
  clear(): Promise<void>;
} {
  const tokens = new Map<string, string>();
  return {
    save(input): Promise<void> {
      tokens.set(input.chatId, input.token);
      return Promise.resolve();
    },
    get(chatId): Promise<{ chatId: string; token: string } | null> {
      const token = tokens.get(chatId);
      if (token === undefined) {
        return Promise.resolve(null);
      }
      return Promise.resolve({ chatId, token });
    },
    clear(): Promise<void> {
      tokens.clear();
      return Promise.resolve();
    }
  };
}

export function inMemoryQueue(): {
  enqueue(): Promise<void>;
  claimReadyForChat(): Promise<[]>;
  markDelivered(): Promise<void>;
  releaseClaimed(): Promise<void>;
  getSummary(): Promise<{ readyCount: number; claimedCount: number }>;
  clear(): Promise<void>;
} {
  return {
    enqueue: () => Promise.resolve(),
    claimReadyForChat: () => Promise.resolve([]),
    markDelivered: () => Promise.resolve(),
    releaseClaimed: () => Promise.resolve(),
    getSummary: () => Promise.resolve({
      readyCount: 0,
      claimedCount: 0
    }),
    clear: () => Promise.resolve()
  };
}

export function isStatusWithErrorTimestamp(value: unknown): value is {
  connection: { lastPollErrorAt: number };
} {
  if (typeof value !== 'object' || value === null || !('connection' in value)) {
    return false;
  }
  const { connection } = value;
  return typeof connection === 'object'
    && connection !== null
    && 'lastPollErrorAt' in connection
    && typeof connection.lastPollErrorAt === 'number';
}

export { rm, join, createTempLinnsyHome, createContextTokenStore, createWechatGatewayApp, createWechatGatewayRunner, createOutboundQueue, createWechatGatewayStatusTracker };
