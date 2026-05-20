import { describe, expect, test, vi } from 'vitest';

import { createDesktopChannelAdapter } from '../../desktop-channel-adapter.js';
import { createDesktopMessageBus } from '../../desktop-message-bus.js';
import type { DesktopMessageBusPort } from '../../desktop-message-bus.js';
import { createDesktopRoutes } from '../desktop-routes.js';

describe('desktop routes', () => {
  test('accepts desktop messages', async () => {
    const receive = vi.fn(() => Promise.resolve());
    const app = createDesktopRoutes({
      bus: desktopBus({
        receive
      })
    });

    const posted = await app.request('/api/v1/desktop/messages', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text: 'hello' })
    });
    expect(posted.status).toBe(200);
    await expect(posted.json()).resolves.toEqual({ ok: true });
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello',
      chatId: 'window:main',
      chatType: 'private',
      userId: 'desktop-owner'
    }));
  });

  test('bridges HTTP desktop messages through the DesktopChannel adapter', async () => {
    const idFactory = vi.fn(() => 'out_1');
    const bus = createDesktopMessageBus({
      idFactory
    });
    const channel = createDesktopChannelAdapter({
      connection: bus,
      messageIdFactory: () => 'in_1',
      clock: { now: () => 9 }
    });
    await channel.start(async (message) => {
      await channel.send({
        platform: 'desktop',
        chatType: 'private',
        chatId: message.chatId
      }, { text: `echo:${message.text ?? ''}` });
    });
    const app = createDesktopRoutes({
      bus
    });

    await app.request('/api/v1/desktop/messages', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text: 'hello' })
    });

    expect(idFactory).toHaveBeenCalledTimes(1);
  });
});

function desktopBus(overrides: Partial<DesktopMessageBusPort>): DesktopMessageBusPort {
  return {
    onMessage: () => () => undefined,
    receive: () => Promise.resolve(),
    send: () => Promise.resolve({}),
    healthcheck: () => Promise.resolve({ ok: true }),
    ...overrides
  };
}
