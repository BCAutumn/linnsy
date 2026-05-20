import { describe, expect, test } from 'vitest';

import { LINNSY_ERROR_CODES } from '../../../../../shared/errors.js';

import {
  createTelegramChannelAdapter,
  TELEGRAM_PLATFORM,
  type TelegramBotPort,
  type TelegramSendOptions,
  type TelegramTextContext
} from '../telegram-channel-adapter.js';

describe('createTelegramChannelAdapter', () => {
  test('starts long polling and converts private text updates into LinnsyMessage', async () => {
    const bot = createFakeTelegramBot();
    const adapter = createTelegramChannelAdapter({
      bot,
      clock: { now: () => 1234 },
      messageIdFactory: (ctx) => `tg_${ctx.updateId.toString()}`
    });
    const messages: unknown[] = [];

    await adapter.start((message) => {
      messages.push(message);
      return Promise.resolve();
    });
    await bot.emitText({
      updateId: 99,
      messageId: 7,
      chat: { id: 42, type: 'private' },
      from: { id: 9, username: 'owner' },
      text: 'hello',
      raw: { update_id: 99 }
    });

    expect(bot.started).toBe(true);
    expect(messages).toEqual([
      {
        messageId: 'tg_99',
        platform: TELEGRAM_PLATFORM,
        chatType: 'private',
        chatId: '42',
        userId: '9',
        providerMessageId: '42:7',
        text: 'hello',
        receivedAt: 1234,
        metadata: { updateId: 99, username: 'owner' }
      }
    ]);
  });

  test('maps supergroups to group chat type and keeps title metadata', async () => {
    const bot = createFakeTelegramBot();
    const adapter = createTelegramChannelAdapter({ bot, clock: { now: () => 1234 } });
    const messages: unknown[] = [];

    await adapter.start((message) => {
      messages.push(message);
      return Promise.resolve();
    });
    await bot.emitText({
      updateId: 100,
      messageId: 8,
      chat: { id: -1001, type: 'supergroup', title: 'Ops' },
      text: 'group hello',
      raw: { update_id: 100 }
    });

    expect(messages).toEqual([
      expect.objectContaining({
        platform: 'telegram',
        chatType: 'group',
        chatId: '-1001',
        providerMessageId: '-1001:8',
        metadata: { updateId: 100, chatTitle: 'Ops' }
      })
    ]);
  });

  test('sends text replies through Telegram sendMessage', async () => {
    const bot = createFakeTelegramBot();
    const adapter = createTelegramChannelAdapter({ bot });

    await adapter.start(() => Promise.resolve());
    await expect(adapter.send(
      { platform: 'telegram', chatType: 'private', chatId: '42', replyToProviderMessageId: '42:7' },
      { text: 'pong', hints: { markdown: true } }
    )).resolves.toEqual({ delivery: 'sent', providerMessageId: '42:1' });

    expect(bot.sent).toEqual([
      {
        chatId: 42,
        text: 'pong',
        options: { reply_to_message_id: 7, parse_mode: 'MarkdownV2' }
      }
    ]);
  });

  test('rejects send before start', async () => {
    const adapter = createTelegramChannelAdapter({ bot: createFakeTelegramBot() });

    await expect(adapter.send(
      { platform: 'telegram', chatType: 'private', chatId: '42' },
      { text: 'pong' }
    )).rejects.toMatchObject({ code: LINNSY_ERROR_CODES.CHANNEL_NOT_STARTED });
  });
});

function createFakeTelegramBot(): TelegramBotPort & {
  started: boolean;
  stopped: boolean;
  sent: Array<{ chatId: string | number; text: string; options: TelegramSendOptions }>;
  emitText(ctx: TelegramTextContext): Promise<void>;
} {
  let handler: ((ctx: TelegramTextContext) => Promise<void>) | null = null;
  const sent: Array<{ chatId: string | number; text: string; options: TelegramSendOptions }> = [];
  return {
    started: false,
    stopped: false,
    sent,
    onText(nextHandler) {
      handler = nextHandler;
    },
    start() {
      this.started = true;
      return Promise.resolve();
    },
    stop() {
      this.stopped = true;
      return Promise.resolve();
    },
    sendMessage(chatId, text, options) {
      sent.push({ chatId, text, options: options ?? {} });
      return Promise.resolve({ messageId: sent.length });
    },
    healthcheck() {
      return Promise.resolve({ ok: true });
    },
    async emitText(ctx) {
      if (handler === null) {
        throw new Error('handler not registered');
      }
      await handler(ctx);
    }
  };
}
