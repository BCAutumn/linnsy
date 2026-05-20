import { rm } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';

import { createMockChannel } from './mock-channel.js';
import { assertNoBoundaryViolation } from './boundary.js';
import { createFakeClock } from './fake-clock.js';
import { createTestDatabase } from './test-database.js';

describe('shared S0 test harness', () => {
  test('creates a sqlite database without touching the real linnsy home', async () => {
    const harness = await createTestDatabase();

    try {
      const table = harness.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'checkpoints'")
        .get();

      expect(table).toBeDefined();
      expect(harness.home).toContain('linnsy-home-');
    } finally {
      harness.db.close();
      await rm(harness.home, { recursive: true, force: true });
    }
  });

  test('provides a deterministic fake clock', () => {
    const clock = createFakeClock(1000);

    expect(clock.now()).toBe(1000);

    clock.advance(250);

    expect(clock.now()).toBe(1250);
  });

  test('records inbound and outbound mock channel messages', async () => {
    const channel = createMockChannel('cli');

    channel.pushInbound({ conversationId: 'conv_1', text: 'hello' });
    await channel.send({ conversationId: 'conv_1', text: 'hi' });

    expect(channel.drainInbound()).toEqual([{ conversationId: 'conv_1', text: 'hello' }]);
    expect(channel.sent).toEqual([{ conversationId: 'conv_1', text: 'hi' }]);
  });

  test('asserts the current package has no boundary violations', async () => {
    await expect(assertNoBoundaryViolation()).resolves.toBeUndefined();
  });
});
