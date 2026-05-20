import { randomUUID } from 'node:crypto';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../shared/errors.js';
import { isRecord } from '../../../../shared/json.js';
import type {
  LinnsyAttachment,
  LinnsyMessage,
  OutboundPayload,
  Platform,
  SendTarget
} from '../../../../shared/messaging.js';
import type { LoggerPort } from '../../../../shared/ports.js';
import { consoleLogger } from '../../../../shared/ports.js';

import type {
  ChannelAdapterPort,
  ChannelHealth,
  ChannelSendResult,
  InboundHandler
} from '../../definitions/types.js';

export const WECHAT_PLATFORM: Platform = 'wechat';

export interface WechatGatewayInboundEvent {
  providerMessageId: string;
  chatId: string;
  userId?: string;
  text: string;
  receivedAt: number;
  metadata?: Record<string, unknown>;
}

export interface WechatGatewaySendResult {
  status: 'sent' | 'deferred' | 'failed';
  providerMessageId?: string;
  deferredReason?: string;
  error?: string;
}

export interface WechatGatewayClientPort {
  pollInbound(): Promise<{ events: WechatGatewayInboundEvent[] }>;
  send(input: {
    target: { chatId: string; chatType: 'private' };
    payload: OutboundPayload;
    deliveryMode: 'reply' | 'proactive';
  }): Promise<WechatGatewaySendResult>;
  healthcheck(): Promise<ChannelHealth>;
}

export interface WechatChannelAdapterOptions {
  gateway: WechatGatewayClientPort;
  pollIntervalMs: number;
  logger?: LoggerPort;
  messageIdFactory?: () => string;
}

export interface CreateHttpWechatGatewayClientOptions {
  baseUrl: string;
  bearerToken: string;
  fetch?: FetchLike;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface AdapterState {
  started: boolean;
  handler: InboundHandler | null;
  timer: ReturnType<typeof setTimeout> | null;
  pollInFlight: Promise<void> | null;
  consecutiveFailures: number;
  suppressedFailures: number;
}

const MAX_POLL_BACKOFF_MS = 30_000;

export function createWechatChannelAdapter(
  options: WechatChannelAdapterOptions
): ChannelAdapterPort {
  const logger = options.logger ?? consoleLogger;
  const messageIdFactory = options.messageIdFactory ?? defaultMessageIdFactory;
  const state: AdapterState = {
    started: false,
    handler: null,
    timer: null,
    pollInFlight: null,
    consecutiveFailures: 0,
    suppressedFailures: 0
  };

  async function pollOnce(): Promise<void> {
    const handler = state.handler;
    if (handler === null) {
      return;
    }

    const batch = await options.gateway.pollInbound();
    for (const event of batch.events) {
      const message: LinnsyMessage = {
        messageId: messageIdFactory(),
        platform: WECHAT_PLATFORM,
        chatType: 'private',
        chatId: event.chatId,
        ...(event.userId === undefined ? {} : { userId: event.userId }),
        providerMessageId: event.providerMessageId,
        text: event.text,
        receivedAt: event.receivedAt,
        ...(event.metadata === undefined ? {} : { metadata: event.metadata })
      };
      await handler(message);
    }
    if (state.consecutiveFailures > 0) {
      logger.info('wechat-channel inbound poll recovered', {
        platform: WECHAT_PLATFORM,
        suppressedFailures: state.suppressedFailures
      });
    }
    state.consecutiveFailures = 0;
    state.suppressedFailures = 0;
  }

  function scheduleNextPoll(): void {
    if (!state.started || state.handler === null) {
      return;
    }

    state.timer = setTimeout(() => {
      void kickPollLoop();
    }, getNextPollDelayMs());
  }

  async function kickPollLoop(): Promise<void> {
    if (!state.started || state.handler === null || state.pollInFlight !== null) {
      return;
    }

    const currentPoll = pollOnce()
      .catch((error: unknown) => {
        handlePollFailure(error);
      })
      .finally(() => {
        state.pollInFlight = null;
        scheduleNextPoll();
      });

    state.pollInFlight = currentPoll;
    await currentPoll;
  }

  return {
    platform: WECHAT_PLATFORM,

    start(handler: InboundHandler): Promise<void> {
      if (state.started) {
        throw new LinnsyError(
          LINNSY_ERROR_CODES.CHANNEL_NOT_STARTED,
          'WeChat channel adapter is already started; call stop() before start() again',
          false
        );
      }

      state.started = true;
      state.handler = handler;
      void kickPollLoop();
      logger.info('wechat channel adapter started', { platform: WECHAT_PLATFORM });
      return Promise.resolve();
    },

    stop(): Promise<void> {
      if (!state.started) {
        return Promise.resolve();
      }

      state.started = false;
      state.handler = null;
      if (state.timer !== null) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      logger.info('wechat channel adapter stopped', { platform: WECHAT_PLATFORM });
      return Promise.resolve();
    },

    async send(target: SendTarget, payload: OutboundPayload): Promise<ChannelSendResult> {
      if (!state.started) {
        throw new LinnsyError(
          LINNSY_ERROR_CODES.CHANNEL_NOT_STARTED,
          'WeChat channel adapter is not started; cannot send outbound payload',
          false
        );
      }
      if (target.platform !== WECHAT_PLATFORM) {
        logger.warn('wechat-channel received non-wechat send target; routing as wechat anyway', {
          requestedPlatform: target.platform
        });
      }
      if (target.chatType !== 'private') {
        return {
          delivery: 'failed',
          detail: 'wechat channel only supports private chats'
        };
      }

      const result = await options.gateway.send({
        target: {
          chatId: target.chatId,
          chatType: 'private'
        },
        payload: {
          ...payload,
          text: renderPayload(payload)
        },
        deliveryMode: target.replyToProviderMessageId === undefined ? 'proactive' : 'reply'
      });

      if (result.status === 'sent') {
        return {
          delivery: 'sent',
          ...(result.providerMessageId === undefined
            ? {}
            : { providerMessageId: result.providerMessageId })
        };
      }
      if (result.status === 'deferred') {
        return {
          delivery: 'deferred',
          ...(result.deferredReason === undefined ? {} : { detail: result.deferredReason })
        };
      }
      return {
        delivery: 'failed',
        detail: result.error ?? 'wechat gateway send failed'
      };
    },

    async healthcheck(): Promise<ChannelHealth> {
      if (!state.started) {
        return { ok: false, detail: 'channel not started' };
      }
      return options.gateway.healthcheck();
    }
  };

  function handlePollFailure(error: unknown): void {
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures === 1) {
      logger.warn('wechat-channel gateway offline; inbound polling is backing off', {
        platform: WECHAT_PLATFORM,
        nextRetryMs: getNextPollDelayMs(),
        error: serializeError(error)
      });
      return;
    }
    state.suppressedFailures += 1;
    if (state.consecutiveFailures % 10 === 0) {
      logger.warn('wechat-channel gateway still offline; repeated poll failures suppressed', {
        platform: WECHAT_PLATFORM,
        consecutiveFailures: state.consecutiveFailures,
        suppressedFailures: state.suppressedFailures,
        nextRetryMs: getNextPollDelayMs(),
        error: serializeError(error)
      });
      state.suppressedFailures = 0;
    }
  }

  function getNextPollDelayMs(): number {
    if (state.consecutiveFailures === 0) {
      return options.pollIntervalMs;
    }
    const multiplier = 2 ** Math.min(state.consecutiveFailures, 5);
    return Math.min(options.pollIntervalMs * multiplier, MAX_POLL_BACKOFF_MS);
  }
}

export function createHttpWechatGatewayClient(
  options: CreateHttpWechatGatewayClientOptions
): WechatGatewayClientPort {
  const fetchImpl = options.fetch ?? globalThis.fetch;

  return {
    async pollInbound(): Promise<{ events: WechatGatewayInboundEvent[] }> {
      const response = await fetchImpl(buildGatewayUrl(options.baseUrl, 'v1/inbound/poll'), {
        method: 'GET',
        headers: buildGatewayHeaders(options.bearerToken)
      });
      const body = await readGatewayJson(response);
      return parseInboundBatch(body);
    },

    async send(input): Promise<WechatGatewaySendResult> {
      const response = await fetchImpl(buildGatewayUrl(options.baseUrl, 'v1/outbound/send'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.bearerToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(input)
      });
      const body = await readGatewayJsonAllowingFailures(response);
      return parseSendResult(body);
    },

    async healthcheck(): Promise<ChannelHealth> {
      const response = await fetchImpl(buildGatewayUrl(options.baseUrl, 'v1/health'), {
        method: 'GET',
        headers: buildGatewayHeaders(options.bearerToken)
      });
      const body = await readGatewayJson(response);
      if (!isRecord(body) || typeof body.ok !== 'boolean') {
        throw new Error('invalid wechat gateway health response');
      }
      return body.ok
        ? { ok: true }
        : { ok: false, detail: typeof body.detail === 'string' ? body.detail : 'gateway healthcheck failed' };
    }
  };
}

function defaultMessageIdFactory(): string {
  return `wechat_${randomUUID()}`;
}

function buildGatewayUrl(baseUrl: string, path: string): string {
  const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(path, normalized).toString();
}

function buildGatewayHeaders(bearerToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${bearerToken}`
  };
}

function renderPayload(payload: OutboundPayload): string {
  const parts: string[] = [];
  if (payload.text !== undefined && payload.text.length > 0) {
    parts.push(payload.text);
  }
  if (payload.attachments !== undefined) {
    for (const attachment of payload.attachments) {
      parts.push(renderAttachmentFallback(attachment));
    }
  }
  return parts.length === 0 ? ' ' : parts.join('\n');
}

function renderAttachmentFallback(attachment: LinnsyAttachment): string {
  const filename = attachment.filename ?? attachment.uri;
  return `[attachment:${attachment.kind}] ${filename}`;
}

function serializeError(error: unknown): { message: string; code?: string } {
  if (error instanceof Error) {
    const result: { message: string; code?: string } = { message: error.message };
    if (error instanceof LinnsyError) {
      result.code = error.code;
    }
    return result;
  }
  return { message: String(error) };
}

async function readGatewayJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`wechat gateway transport failed: ${response.status.toString()} ${response.statusText}`);
  }
  return response.json() as Promise<unknown>;
}

async function readGatewayJsonAllowingFailures(response: Response): Promise<unknown> {
  return response.json() as Promise<unknown>;
}

function parseInboundBatch(body: unknown): { events: WechatGatewayInboundEvent[] } {
  if (!isRecord(body) || body.ok !== true || !Array.isArray(body.events)) {
    throw new Error('invalid wechat gateway inbound response');
  }

  return {
    events: body.events.map(parseInboundEvent)
  };
}

function parseInboundEvent(value: unknown): WechatGatewayInboundEvent {
  if (!isRecord(value)) {
    throw new Error('invalid wechat gateway inbound event');
  }
  if (
    typeof value.providerMessageId !== 'string'
    || typeof value.chatId !== 'string'
    || typeof value.text !== 'string'
    || typeof value.receivedAt !== 'number'
  ) {
    throw new Error('invalid wechat gateway inbound event fields');
  }
  if (value.userId !== undefined && typeof value.userId !== 'string') {
    throw new Error('invalid wechat gateway inbound event userId');
  }
  if (value.metadata !== undefined && !isRecord(value.metadata)) {
    throw new Error('invalid wechat gateway inbound event metadata');
  }

  return {
    providerMessageId: value.providerMessageId,
    chatId: value.chatId,
    ...(value.userId === undefined ? {} : { userId: value.userId }),
    text: value.text,
    receivedAt: value.receivedAt,
    ...(value.metadata === undefined ? {} : { metadata: value.metadata })
  };
}

function parseSendResult(body: unknown): WechatGatewaySendResult {
  if (!isRecord(body) || typeof body.status !== 'string') {
    throw new Error('invalid wechat gateway send response');
  }
  if (body.status !== 'sent' && body.status !== 'deferred' && body.status !== 'failed') {
    throw new Error('invalid wechat gateway send status');
  }
  if (body.providerMessageId !== undefined && typeof body.providerMessageId !== 'string') {
    throw new Error('invalid wechat gateway providerMessageId');
  }
  if (body.deferredReason !== undefined && typeof body.deferredReason !== 'string') {
    throw new Error('invalid wechat gateway deferredReason');
  }
  if (body.error !== undefined && typeof body.error !== 'string') {
    throw new Error('invalid wechat gateway error');
  }

  return {
    status: body.status,
    ...(body.providerMessageId === undefined ? {} : { providerMessageId: body.providerMessageId }),
    ...(body.deferredReason === undefined ? {} : { deferredReason: body.deferredReason }),
    ...(body.error === undefined ? {} : { error: body.error })
  };
}
