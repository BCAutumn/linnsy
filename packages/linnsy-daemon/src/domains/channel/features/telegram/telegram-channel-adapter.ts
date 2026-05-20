import { Bot, type Context, type PollingOptions } from 'grammy';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../shared/errors.js';
import type {
  ChatType,
  LinnsyAttachment,
  LinnsyMessage,
  OutboundPayload,
  Platform,
  SendTarget
} from '../../../../shared/messaging.js';
import type { ClockPort, LoggerPort } from '../../../../shared/ports.js';
import { consoleLogger, systemClock } from '../../../../shared/ports.js';

import type {
  ChannelAdapterPort,
  ChannelHealth,
  ChannelSendResult,
  InboundHandler
} from '../../definitions/types.js';

export const TELEGRAM_PLATFORM: Platform = 'telegram';

export interface TelegramTextContext {
  updateId: number;
  messageId: number;
  chat: {
    id: string | number;
    type: string;
    title?: string;
  };
  from?: {
    id: number;
    username?: string;
  };
  text: string;
  raw: unknown;
}

export interface TelegramSendOptions {
  reply_to_message_id?: number;
  parse_mode?: 'MarkdownV2';
}

export interface TelegramBotPort {
  onText(handler: (ctx: TelegramTextContext) => Promise<void>): void;
  start(options?: PollingOptions): Promise<void>;
  stop(): Promise<void>;
  sendMessage(
    chatId: string | number,
    text: string,
    options?: TelegramSendOptions
  ): Promise<{ messageId: number }>;
  healthcheck(): Promise<ChannelHealth>;
}

export interface TelegramChannelAdapterOptions {
  token?: string;
  bot?: TelegramBotPort;
  clock?: ClockPort;
  logger?: LoggerPort;
  messageIdFactory?: (ctx: TelegramTextContext) => string;
  pollingOptions?: PollingOptions;
}

export function createTelegramChannelAdapter(
  options: TelegramChannelAdapterOptions
): ChannelAdapterPort {
  const bot = options.bot ?? createGrammyTelegramBot(readToken(options.token));
  const clock = options.clock ?? systemClock;
  const logger = options.logger ?? consoleLogger;
  const messageIdFactory = options.messageIdFactory ?? defaultTelegramMessageIdFactory;
  const pollingOptions = options.pollingOptions ?? { drop_pending_updates: false };

  const state = {
    started: false,
    handler: null as InboundHandler | null
  };

  bot.onText(async (ctx) => {
    const handler = state.handler;
    if (handler === null) {
      return;
    }
    const message = toLinnsyMessage(ctx, clock, messageIdFactory);
    await handler(message);
  });

  return {
    platform: TELEGRAM_PLATFORM,

    async start(handler: InboundHandler): Promise<void> {
      if (state.started) {
        throw new LinnsyError(
          LINNSY_ERROR_CODES.CHANNEL_NOT_STARTED,
          'Telegram channel adapter is already started; call stop() before start() again',
          false
        );
      }
      state.handler = handler;
      await bot.start(pollingOptions);
      state.started = true;
      logger.info('telegram channel adapter started', { platform: TELEGRAM_PLATFORM });
    },

    async stop(): Promise<void> {
      if (!state.started) {
        return;
      }
      state.handler = null;
      await bot.stop();
      state.started = false;
      logger.info('telegram channel adapter stopped', { platform: TELEGRAM_PLATFORM });
    },

    async send(target: SendTarget, payload: OutboundPayload): Promise<ChannelSendResult> {
      if (!state.started) {
        throw new LinnsyError(
          LINNSY_ERROR_CODES.CHANNEL_NOT_STARTED,
          'Telegram channel adapter is not started; cannot send outbound payload',
          false
        );
      }
      if (target.platform !== TELEGRAM_PLATFORM) {
        logger.warn('telegram-channel received non-telegram send target; routing as telegram anyway', {
          requestedPlatform: target.platform
        });
      }

      const text = renderPayload(payload);
      const chatId = parseTelegramChatId(target.chatId);
      const options = buildSendOptions(target, payload);
      const result = await bot.sendMessage(chatId, text, options);
      return { delivery: 'sent', providerMessageId: `${target.chatId}:${result.messageId.toString()}` };
    },

    healthcheck(): Promise<ChannelHealth> {
      if (!state.started) {
        return Promise.resolve({ ok: false, detail: 'channel not started' });
      }
      return bot.healthcheck();
    }
  };
}

function createGrammyTelegramBot(token: string): TelegramBotPort {
  const bot = new Bot(token);
  return {
    onText(handler): void {
      bot.on('message:text', async (ctx) => {
        const textContext = toTelegramTextContext(ctx);
        if (textContext !== null) {
          await handler(textContext);
        }
      });
    },
    start(options): Promise<void> {
      return bot.start(options);
    },
    stop(): Promise<void> {
      return bot.stop();
    },
    async sendMessage(chatId, text, options): Promise<{ messageId: number }> {
      const sent = await bot.api.sendMessage(chatId, text, options);
      return { messageId: sent.message_id };
    },
    async healthcheck(): Promise<ChannelHealth> {
      try {
        await bot.api.getMe();
        return { ok: true };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { ok: false, detail };
      }
    }
  };
}

function toTelegramTextContext(ctx: Context): TelegramTextContext | null {
  const message = ctx.message;
  if (message === undefined || typeof message.text !== 'string') {
    return null;
  }
  const from = message.from;
  return {
    updateId: ctx.update.update_id,
    messageId: message.message_id,
    chat: {
      id: message.chat.id,
      type: message.chat.type,
      ...('title' in message.chat && typeof message.chat.title === 'string'
        ? { title: message.chat.title }
        : {})
    },
    from: {
      id: from.id,
      ...(from.username === undefined ? {} : { username: from.username })
    },
    text: message.text,
    raw: ctx.update
  };
}

function toLinnsyMessage(
  ctx: TelegramTextContext,
  clock: ClockPort,
  messageIdFactory: (ctx: TelegramTextContext) => string
): LinnsyMessage {
  return {
    messageId: messageIdFactory(ctx),
    platform: TELEGRAM_PLATFORM,
    chatType: mapTelegramChatType(ctx.chat.type),
    chatId: String(ctx.chat.id),
    ...(ctx.from === undefined ? {} : { userId: ctx.from.id.toString() }),
    providerMessageId: `${String(ctx.chat.id)}:${ctx.messageId.toString()}`,
    text: ctx.text,
    receivedAt: clock.now(),
    metadata: {
      updateId: ctx.updateId,
      ...(ctx.from?.username === undefined ? {} : { username: ctx.from.username }),
      ...(ctx.chat.title === undefined ? {} : { chatTitle: ctx.chat.title })
    }
  };
}

function mapTelegramChatType(type: string): ChatType {
  if (type === 'private') {
    return 'private';
  }
  if (type === 'channel') {
    return 'channel';
  }
  return 'group';
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

function buildSendOptions(target: SendTarget, payload: OutboundPayload): TelegramSendOptions | undefined {
  const options: TelegramSendOptions = {};
  const replyToMessageId = parseReplyToMessageId(target.replyToProviderMessageId);
  if (replyToMessageId !== undefined) {
    options.reply_to_message_id = replyToMessageId;
  }
  if (payload.hints?.markdown === true) {
    options.parse_mode = 'MarkdownV2';
  }
  return Object.keys(options).length === 0 ? undefined : options;
}

function parseReplyToMessageId(providerMessageId: string | undefined): number | undefined {
  if (providerMessageId === undefined) {
    return undefined;
  }
  const [, messageId] = providerMessageId.split(':');
  if (messageId === undefined) {
    return undefined;
  }
  const parsed = Number(messageId);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parseTelegramChatId(chatId: string): string | number {
  const parsed = Number(chatId);
  return Number.isSafeInteger(parsed) && parsed.toString() === chatId ? parsed : chatId;
}

function defaultTelegramMessageIdFactory(ctx: TelegramTextContext): string {
  return `tg_${ctx.updateId.toString()}`;
}

function readToken(token: string | undefined): string {
  if (token === undefined || token.length === 0) {
    throw new LinnsyError(
      LINNSY_ERROR_CODES.CHANNEL_NOT_STARTED,
      'Telegram channel adapter requires a bot token',
      false
    );
  }
  return token;
}
