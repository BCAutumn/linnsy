import { describe, expect, test } from 'vitest';

import { createDesktopMessageBus } from '../desktop-message-bus.js';

describe('createDesktopMessageBus', () => {
  test('delivers inbound payloads to listeners and returns provider ids for outbound replies', async () => {
    const received: string[] = [];
    const bus = createDesktopMessageBus({
      idFactory: () => 'out_1'
    });
    bus.onMessage((payload) => {
      received.push(payload.text ?? '');
    });

    await bus.receive({ text: 'hello' });
    const sendResult = await bus.send('window:main', { text: 'reply' });

    expect(received).toEqual(['hello']);
    expect(sendResult).toEqual({ providerMessageId: 'out_1' });
  });
});
