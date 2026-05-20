import { describe, expect, test } from 'vitest';

import { LINNSY_ERROR_CODES } from '../../../../../shared/errors.js';
import type { LinnsyMessage } from '../../../../../shared/messaging.js';
import {
  DESKTOP_PLATFORM,
  createDesktopChannelAdapter,
  type DesktopConnectionPort
} from '../desktop-channel-adapter.js';

describe('desktop channel adapter', () => {
  test('wraps desktop inbound payloads as LinnsyMessage', async () => {
    const connection = createMemoryDesktopConnection();
    const messages: LinnsyMessage[] = [];
    const adapter = createDesktopChannelAdapter({
      connection,
      clock: { now: () => 1_000 },
      messageIdFactory: () => 'desktop_msg_1'
    });

    await adapter.start((message) => {
      messages.push(message);
      return Promise.resolve();
    });
    connection.emit({
      chatId: 'window:main',
      text: 'hello',
      userId: 'local-user',
      providerMessageId: 'renderer_1'
    });

    expect(messages).toEqual([
      expect.objectContaining({
        messageId: 'desktop_msg_1',
        platform: DESKTOP_PLATFORM,
        chatType: 'private',
        chatId: 'window:main',
        userId: 'local-user',
        providerMessageId: 'renderer_1',
        text: 'hello',
        receivedAt: 1_000
      })
    ]);
  });

  test('sends outbound payloads to the desktop connection', async () => {
    const connection = createMemoryDesktopConnection();
    const adapter = createDesktopChannelAdapter({ connection });

    await adapter.start(() => Promise.resolve());
    await expect(adapter.send(
      { platform: DESKTOP_PLATFORM, chatType: 'private', chatId: 'window:main' },
      { text: 'reply' }
    )).resolves.toMatchObject({ delivery: 'sent' });

    expect(connection.sent).toEqual([
      { chatId: 'window:main', payload: { text: 'reply' } }
    ]);
  });

  test('reports health and refuses send before start', async () => {
    const connection = createMemoryDesktopConnection();
    const adapter = createDesktopChannelAdapter({ connection });

    await expect(adapter.healthcheck()).resolves.toEqual({
      ok: false,
      detail: 'channel not started'
    });
    await expect(adapter.send(
      { platform: DESKTOP_PLATFORM, chatType: 'private', chatId: 'window:main' },
      { text: 'reply' }
    )).rejects.toMatchObject({ code: LINNSY_ERROR_CODES.CHANNEL_NOT_STARTED });
  });
});

function createMemoryDesktopConnection(): DesktopConnectionPort & {
  sent: Array<{ chatId: string; payload: { text?: string } }>;
  emit: (payload: { chatId?: string; text?: string; userId?: string; providerMessageId?: string }) => void;
} {
  const listeners = new Set<(payload: {
    chatId?: string;
    text?: string;
    userId?: string;
    providerMessageId?: string;
  }) => void | Promise<void>>();
  return {
    sent: [],
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    send(chatId, payload) {
      this.sent.push({ chatId, payload });
      return Promise.resolve({ providerMessageId: `desktop_${this.sent.length.toString()}` });
    },
    healthcheck() {
      return Promise.resolve({ ok: true });
    },
    emit(payload) {
      for (const listener of listeners) {
        void listener(payload);
      }
    }
  };
}
