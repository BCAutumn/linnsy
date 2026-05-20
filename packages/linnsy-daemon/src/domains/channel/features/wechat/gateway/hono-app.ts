import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import { LINNSY_ERROR_CODES } from '../../../../../shared/errors.js';

import { coalesceDeferredMessages } from './deferred-message-coalescer.js';
import { createWechatGatewayStatusTracker } from './gateway-status.js';
import type { ContextTokenStorePort, OutboundQueuePort, WechatGatewayStatus } from './types.js';
import type {
  WechatGatewayAccount,
  WechatGatewayConnectionSource,
  WechatGatewayStatusPort
} from './types.js';
import type { WechatBotApiPort, WechatBotApiUpdate } from './wechat-bot-api-client.js';

const DEFERRED_MESSAGE_COALESCER = {
  minChunkChars: 80,
  maxChunkChars: 1_500
} as const;

const outboundSendSchema = z.object({
  target: z.object({
    chatId: z.string().min(1),
    chatType: z.literal('private')
  }),
  payload: z.object({
    text: z.string().min(1)
  }),
  deliveryMode: z.enum(['reply', 'proactive'])
});

export interface CreateWechatGatewayAppOptions {
  bearerToken: string;
  wechatBotApi?: WechatBotApiPort;
  runtime?: WechatGatewayRuntimePort;
  tokenStore: ContextTokenStorePort;
  queue: OutboundQueuePort;
  account?: WechatGatewayAccount;
  connectionSource?: WechatGatewayConnectionSource;
  status?: WechatGatewayStatusPort;
  now?: () => number;
  deferredIdFactory?: () => string;
}

export interface WechatGatewayRuntimePort {
  getWechatBotApi(): WechatBotApiPort | null;
  deleteAccount(): Promise<WechatGatewayStatus>;
  requestFreshQrLogin(): Promise<WechatGatewayStatus>;
}

interface NormalizedWechatInboundEvent {
  providerMessageId: string;
  chatId: string;
  userId: string;
  text: string;
  receivedAt: number;
  metadata: Record<string, unknown>;
}

export function createWechatGatewayApp(options: CreateWechatGatewayAppOptions): Hono {
  const app = new Hono();
  const now = options.now ?? Date.now;
  const deferredIdFactory = options.deferredIdFactory ?? nanoid;
  const status = options.status ?? createWechatGatewayStatusTracker({
    queue: options.queue,
    ...(options.account === undefined ? {} : { account: options.account }),
    ...(options.connectionSource === undefined ? {} : { connectionSource: options.connectionSource })
  });

  app.use('/v1/*', async (context, next) => {
    const authorization = context.req.header('authorization');
    if (authorization !== `Bearer ${options.bearerToken}`) {
      return context.json({
        ok: false,
        code: LINNSY_ERROR_CODES.HTTP_BEARER_REQUIRED
      }, 401);
    }

    await next();
  });

  app.get('/v1/health', (context) => {
    return context.json({ ok: true });
  });

  app.get('/v1/status', async (context) => {
    return context.json(await status.snapshot());
  });

  app.delete('/v1/account', async (context) => {
    if (options.runtime === undefined) {
      return context.json({
        ok: false,
        status: 'failed',
        error: 'wechat_gateway_account_runtime_unavailable'
      }, 409);
    }

    try {
      return context.json(await options.runtime.deleteAccount());
    } catch (error: unknown) {
      return context.json({
        ok: false,
        status: 'failed',
        error: toErrorMessage(error)
      }, 502);
    }
  });

  app.post('/v1/qr-login/show', async (context) => {
    if (options.runtime === undefined) {
      return context.json({
        ok: false,
        status: 'failed',
        error: 'wechat_gateway_qr_login_runtime_unavailable'
      }, 409);
    }

    try {
      return context.json(await options.runtime.requestFreshQrLogin());
    } catch (error: unknown) {
      return context.json({
        ok: false,
        status: 'failed',
        error: toErrorMessage(error)
      }, 502);
    }
  });

  app.get('/v1/inbound/poll', async (context) => {
    const wechatBotApi = readWechatBotApiClient(options);
    if (wechatBotApi === null) {
      return context.json({
        ok: false,
        status: 'failed',
        error: 'wechat_gateway_not_connected'
      }, 503);
    }

    try {
      const polled = await wechatBotApi.getUpdates();
      const events: NormalizedWechatInboundEvent[] = [];
      const latestTokensByChat = new Map<string, string>();

      for (const update of polled.updates) {
        const inboundEvent = normalizePrivateTextInbound(update);
        if (inboundEvent !== null) {
          events.push(inboundEvent);
        }
        if (
          update.messageType === 'user'
          && update.contextToken !== undefined
          && typeof update.fromUserId === 'string'
        ) {
          latestTokensByChat.set(update.fromUserId, update.contextToken);
        }
      }

      for (const [chatId, token] of latestTokensByChat) {
        await options.tokenStore.save({
          chatId,
          token
        });
        await flushDeferredQueueForChat({ ...options, wechatBotApi }, chatId, token);
      }
      await wechatBotApi.commitCursor(polled.nextCursor);
      status.recordPollSuccess(now());

      return context.json({ ok: true, events });
    } catch (error: unknown) {
      status.recordPollFailure(now(), toErrorMessage(error));
      return context.json({
        ok: false,
        status: 'failed',
        error: toErrorMessage(error)
      }, 502);
    }
  });

  app.post('/v1/outbound/send', zValidator('json', outboundSendSchema), async (context) => {
    const input = context.req.valid('json');
    const tokenRecord = await options.tokenStore.get(input.target.chatId);

    if (tokenRecord === null) {
      if (input.deliveryMode === 'proactive') {
        await options.queue.enqueue({
          deferredId: deferredIdFactory(),
          chatId: input.target.chatId,
          text: input.payload.text,
          deliveryMode: input.deliveryMode,
          createdAt: now()
        });
        return context.json({
          ok: true,
          status: 'deferred',
          deferredReason: 'missing_context_token'
        });
      }

      return context.json({
        ok: false,
        status: 'failed',
        error: 'missing_context_token'
      }, 409);
    }

    const wechatBotApi = readWechatBotApiClient(options);
    if (wechatBotApi === null) {
      return context.json({
        ok: false,
        status: 'failed',
        error: 'wechat_gateway_not_connected'
      }, 503);
    }

    try {
      await wechatBotApi.sendMessage({
        toUserId: input.target.chatId,
        text: input.payload.text,
        contextToken: tokenRecord.token
      });
      return context.json({
        ok: true,
        status: 'sent'
      });
    } catch (error: unknown) {
      return context.json({
        ok: false,
        status: 'failed',
        error: toErrorMessage(error)
      }, 502);
    }
  });

  return app;
}

function readWechatBotApiClient(options: Pick<CreateWechatGatewayAppOptions, 'wechatBotApi' | 'runtime'>): WechatBotApiPort | null {
  if (options.runtime !== undefined) {
    return options.runtime.getWechatBotApi();
  }
  return options.wechatBotApi ?? null;
}

async function flushDeferredQueueForChat(
  options: Pick<CreateWechatGatewayAppOptions, 'wechatBotApi' | 'queue'> & { wechatBotApi: WechatBotApiPort },
  chatId: string,
  contextToken: string
): Promise<void> {
  const claimed = await options.queue.claimReadyForChat(chatId);
  if (claimed.length === 0) {
    return;
  }

  const deliveredIds: string[] = [];
  const batches = coalesceDeferredMessages(claimed, DEFERRED_MESSAGE_COALESCER);

  try {
    for (const batch of batches) {
      await options.wechatBotApi.sendMessage({
        toUserId: chatId,
        text: batch.text,
        contextToken
      });
      deliveredIds.push(...batch.deferredIds);
    }
  } catch (error: unknown) {
    const deliveredIdSet = new Set(deliveredIds);
    const pendingIds = claimed
      .map((message) => message.deferredId)
      .filter((deferredId) => !deliveredIdSet.has(deferredId));

    if (deliveredIds.length > 0) {
      await options.queue.markDelivered(deliveredIds);
    }
    if (pendingIds.length > 0) {
      await options.queue.releaseClaimed(pendingIds);
    }

    throw error;
  }

  await options.queue.markDelivered(claimed.map((message) => message.deferredId));
}

function normalizePrivateTextInbound(update: WechatBotApiUpdate): NormalizedWechatInboundEvent | null {
  if (
    update.messageType !== 'user'
    || typeof update.fromUserId !== 'string'
    || typeof update.text !== 'string'
  ) {
    return null;
  }

  return {
    providerMessageId: update.providerMessageId,
    chatId: update.fromUserId,
    userId: update.fromUserId,
    text: update.text,
    receivedAt: update.receivedAt,
    metadata: update.metadata ?? {}
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
