import { describe, expect, test } from 'vitest';

import {
  CLI_PLATFORM,
  LINNSY_FENCE_KINDS,
  consumePendingContextFences,
  createCliChannelAdapter,
  createFixture,
  createLinnsyDaemon,
  createManualChannel,
  fixtures,
  flush
} from './scenarios/daemon-support.js';
import type { RunExecutorPort, RunOutcome, RunSpawnerPort } from './scenarios/daemon-support.js';

describe('Linnsy daemon failures and interjections', () => {
  test('skips reply when auth guard denies', async () => {
    const fixture = await createFixture();
    fixtures.push(fixture);

    const executor: RunExecutorPort = {
      execute(): Promise<RunOutcome> {
        return Promise.resolve({ status: 'completed', finalAnswer: 'never' });
      }
    };

    const channel = createCliChannelAdapter({
      stdin: fixture.stdin,
      stdout: fixture.stdout
    });
    const daemon = createLinnsyDaemon({
      foundation: fixture.foundation,
      channels: [channel],
      executor,
      awaitTurnInHandler: true,
      authGuard: {
        authorize() {
          return Promise.resolve({ allow: false, reason: 'phase1-blocklist' });
        }
      }
    });

    await daemon.start();
    fixture.stdin.write('blocked\n');
    await flush();
    await flush();
    await daemon.stop();

    expect(fixture.stdoutChunks.join('')).toBe('');
    const conversations = await fixture.foundation.conversations.list({});
    expect(conversations.length).toBe(1);
    expect(conversations[0]).toMatchObject({
      platform: 'desktop',
      chatType: 'private',
      chatId: 'window:main'
    });
  });

  test('handles executor failure without spamming the channel', async () => {
    const fixture = await createFixture();
    fixtures.push(fixture);

    const executor: RunExecutorPort = {
      execute(): Promise<RunOutcome> {
        return Promise.reject(new Error('transient'));
      }
    };

    const channel = createCliChannelAdapter({
      stdin: fixture.stdin,
      stdout: fixture.stdout
    });
    const daemon = createLinnsyDaemon({
      foundation: fixture.foundation,
      channels: [channel],
      executor,
      awaitTurnInHandler: true
    });

    await daemon.start();
    fixture.stdin.write('boom\n');
    await flush();
    await flush();
    await daemon.stop();

    expect(fixture.stdoutChunks.join('')).toBe('');
    const conversations = await fixture.foundation.conversations.list({});
    expect(conversations.length).toBe(2);
    const cliConversation = conversations.find((conversation) => conversation.platform === CLI_PLATFORM);
    const conversationId = cliConversation?.conversationId;
    expect(conversationId).toBeDefined();
    if (conversationId === undefined) {
      throw new Error('conversation should exist');
    }
    const messages = await fixture.foundation.messages.listByConversation(conversationId, { limit: 10 });
    expect(messages.messages.map((m) => m.source)).toEqual(['inbound']);
  });

  test('queues owner messages as user-interjection while a foreground run is active', async () => {
    const fixture = await createFixture();
    fixtures.push(fixture);

    let spawnCount = 0;
    const spawner: RunSpawnerPort = {
      spawnDetached() {
        spawnCount += 1;
        return Promise.resolve({ runId: 'unexpected_run', conversationId: 'conv_active' });
      },
      peek() {
        return Promise.resolve(null);
      },
      cancel() {
        return Promise.resolve();
      },
      waitForTerminal() {
        return Promise.resolve({
          runId: 'unexpected_run',
          type: 'completed',
          outcome: { status: 'completed' }
        });
      },
      findActiveByConversation(conversationId) {
        return Promise.resolve({
          runId: 'run_active',
          conversationId,
          status: 'running',
          startedAt: 10,
          updatedAt: 11
        });
      },
      drain() {
        return Promise.resolve();
      },
      recoverOnBoot() {
        return Promise.resolve({ recovered: 0, abandoned: 0 });
      }
    };

    const channel = createManualChannel('telegram');
    const daemon = createLinnsyDaemon({
      foundation: fixture.foundation,
      channels: [channel],
      executor: {
        execute() {
          return Promise.resolve({ status: 'completed' });
        }
      },
      spawner,
      awaitTurnInHandler: true,
      inboundIdFactory: () => 'in_1'
    });

    await daemon.start();
    await channel.emit({
      messageId: 'local_1',
      platform: 'telegram',
      chatType: 'private',
      chatId: 'chat_1',
      providerMessageId: 'provider_1',
      text: 'pause and use the new file',
      receivedAt: 42
    });
    await daemon.stop();

    expect(spawnCount).toBe(0);
    expect(channel.sent).toEqual([]);
    const fences = consumePendingContextFences('run_active');
    expect(fences).toEqual([
      {
        kind: LINNSY_FENCE_KINDS.userInterjection,
        content: 'pause and use the new file',
        attrs: {
          source: 'owner-message',
          messageId: 'in_1',
          receivedAt: 42
        }
      }
    ]);

    const conversations = await fixture.foundation.conversations.list({});
    const conversationId = conversations[0]?.conversationId;
    expect(conversationId).toBeDefined();
    if (conversationId === undefined) {
      throw new Error('conversation should exist');
    }
    const messages = await fixture.foundation.messages.listByConversation(conversationId, { limit: 10 });
    expect(messages.messages.map((m) => `${m.role}:${m.source}:${m.text ?? ''}`)).toEqual([
      'user:inbound:pause and use the new file'
    ]);
  });

});
