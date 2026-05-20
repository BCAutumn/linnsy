import { randomUUID } from 'node:crypto';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../shared/errors.js';
import type { ChatType, LinnsyMessage, OutboundPayload, Platform, SendTarget } from '../../../../shared/messaging.js';
import type { ClockPort, LoggerPort } from '../../../../shared/ports.js';
import { consoleLogger, systemClock } from '../../../../shared/ports.js';
import type {
  ChannelAdapterPort,
  ChannelHealth,
  ChannelSendResult,
  InboundHandler
} from '../../definitions/types.js';

export const DESKTOP_PLATFORM: Platform = 'desktop';

export interface DesktopInboundPayload {
  conversationId?: string;
  chatId?: string;
  chatType?: ChatType;
  userId?: string;
  providerMessageId?: string;
  text?: string;
  metadata?: Record<string, unknown>;
}

export interface DesktopSendResult {
  providerMessageId?: string;
}

export interface DesktopConnectionPort {
  onMessage(listener: (payload: DesktopInboundPayload) => void | Promise<void>): () => void;
  send(chatId: string, payload: OutboundPayload): Promise<DesktopSendResult>;
  healthcheck(): Promise<ChannelHealth>;
}

export interface DesktopChannelAdapterOptions {
  connection: DesktopConnectionPort;
  clock?: ClockPort;
  logger?: LoggerPort;
  messageIdFactory?: () => string;
  defaultChatId?: string;
}

export function createDesktopChannelAdapter(options: DesktopChannelAdapterOptions): ChannelAdapterPort {
  const clock = options.clock ?? systemClock;
  const logger = options.logger ?? consoleLogger;
  const messageIdFactory = options.messageIdFactory ?? defaultMessageIdFactory;
  const defaultChatId = options.defaultChatId ?? 'window:main';
  const state: {
    handler: InboundHandler | null;
    unsubscribe: (() => void) | null;
  } = {
    handler: null,
    unsubscribe: null
  };

  return {
    platform: DESKTOP_PLATFORM,

    start(handler): Promise<void> {
      if (state.handler !== null) {
        return Promise.reject(channelNotStarted('Desktop channel adapter is already started'));
      }
      state.handler = handler;
      state.unsubscribe = options.connection.onMessage(async (payload) => {
        const currentHandler = state.handler;
        if (currentHandler === null) {
          return;
        }
        const message = toLinnsyMessage(payload, defaultChatId, messageIdFactory, clock);
        await currentHandler(message).catch((error: unknown) => {
          logger.error('desktop-channel handler failed', {
            messageId: message.messageId,
            error: error instanceof Error ? error.message : String(error)
          });
        });
      });
      return Promise.resolve();
    },

    stop(): Promise<void> {
      state.handler = null;
      state.unsubscribe?.();
      state.unsubscribe = null;
      return Promise.resolve();
    },

    async send(target: SendTarget, payload: OutboundPayload): Promise<ChannelSendResult> {
      if (state.handler === null) {
        throw channelNotStarted('Desktop channel adapter is not started');
      }
      if (target.platform !== DESKTOP_PLATFORM) {
        logger.warn('desktop-channel received non-desktop send target', {
          requestedPlatform: target.platform
        });
      }
      const result = await options.connection.send(target.chatId, payload);
      const sendResult: ChannelSendResult = {
        delivery: 'sent',
      };
      if (result.providerMessageId !== undefined) {
        sendResult.providerMessageId = result.providerMessageId;
      }
      return sendResult;
    },

    async healthcheck(): Promise<ChannelHealth> {
      if (state.handler === null) {
        return { ok: false, detail: 'channel not started' };
      }
      return options.connection.healthcheck();
    }
  };
}

function toLinnsyMessage(
  payload: DesktopInboundPayload,
  defaultChatId: string,
  messageIdFactory: () => string,
  clock: ClockPort
): LinnsyMessage {
  const message: LinnsyMessage = {
    messageId: messageIdFactory(),
    platform: DESKTOP_PLATFORM,
    chatType: payload.chatType ?? 'private',
    chatId: payload.chatId ?? defaultChatId,
    receivedAt: clock.now()
  };
  if (payload.userId !== undefined) {
    message.userId = payload.userId;
  }
  if (payload.conversationId !== undefined) {
    message.conversationId = payload.conversationId;
  }
  if (payload.providerMessageId !== undefined) {
    message.providerMessageId = payload.providerMessageId;
  }
  if (payload.text !== undefined) {
    message.text = payload.text;
  }
  if (payload.metadata !== undefined) {
    message.metadata = payload.metadata;
  }
  return message;
}

function defaultMessageIdFactory(): string {
  return `desktop_${randomUUID()}`;
}

function channelNotStarted(message: string): LinnsyError {
  return new LinnsyError(LINNSY_ERROR_CODES.CHANNEL_NOT_STARTED, message, false);
}
