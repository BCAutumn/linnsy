import { describe, expect, test } from 'vitest';

import {
  CLI_PLATFORM,
  SqlitePairingStore,
  createAuthorizationGuard,
  createCliChannelAdapter,
  createFixture,
  createLinnsyDaemon,
  createManualChannel,
  fixtures,
  flush
} from './scenarios/daemon-support.js';
import type { RunExecutorPort, RunOutcome, RunSpawnerPort } from './scenarios/daemon-support.js';
import type { SpawnOptions, SpawnResult } from '../../../domains/agent-run/features/run-spawner/types.js';

describe('Linnsy daemon routing', () => {
  test('wires task terminal wake hook through the daemon spawner', async () => {
    const fixture = await createFixture();
    fixtures.push(fixture);
    const spawns: SpawnOptions[] = [];
    const spawner = createCapturingSpawner(spawns);
    createLinnsyDaemon({
      foundation: fixture.foundation,
      channels: [],
      executor: {
        execute() {
          return Promise.resolve({ status: 'completed' });
        }
      },
      spawner
    });
    await fixture.foundation.conversations.upsert({
      conversationId: 'conv_task',
      sessionKey: 'linnsy:main:cli:private:task',
      platform: 'cli',
      chatType: 'private',
      chatId: 'task',
      createdAt: 1,
      updatedAt: 1
    });
    await fixture.foundation.taskTracker.upsert({
      taskId: 'task_1',
      conversationId: 'conv_task',
      title: 'Task',
      status: 'in_progress'
    });

    await fixture.foundation.taskTracker.transition('task_1', 'completed', {
      result: { finalMessage: 'done' }
    });

    expect(spawns).toEqual([
      expect.objectContaining({
        definitionKey: 'linnsy_main',
        conversationId: 'conv_task',
        wakeSource: 'task-completed'
      })
    ]);
  });

  test('routes inbound CLI line through registry, spawner, executor, channel reply', async () => {
    const fixture = await createFixture();
    fixtures.push(fixture);

    const executor: RunExecutorPort = {
      execute(context): Promise<RunOutcome> {
        return Promise.resolve({ status: 'completed', finalAnswer: `echo:${context.query}` });
      }
    };

    const channel = createCliChannelAdapter({
      stdin: fixture.stdin,
      stdout: fixture.stdout,
      outboundPrefix: '> '
    });
    const daemon = createLinnsyDaemon({
      foundation: fixture.foundation,
      channels: [channel],
      executor,
      awaitTurnInHandler: true
    });

    await daemon.start();
    fixture.stdin.write('hello\n');
    await flush();
    await flush();
    await daemon.stop();

    const output = fixture.stdoutChunks.join('');
    expect(output).toContain('> echo:hello');
    expect(fixture.logger.records.filter((record) => record.level === 'warn')).toEqual([]);

    const conversations = await fixture.foundation.conversations.list({});
    expect(conversations.length).toBe(2);
    const cliConversation = conversations.find((conversation) => conversation.platform === CLI_PLATFORM);
    const conversationId = cliConversation?.conversationId;
    expect(conversationId).toBeDefined();
    if (conversationId === undefined) {
      throw new Error('conversation should exist');
    }
    const messages = await fixture.foundation.messages.listByConversation(conversationId, { limit: 10 });
    const sources = messages.messages.map((m) => `${m.role}:${m.source}:${m.text ?? ''}`);
    expect(sources).toEqual(['user:inbound:hello', 'assistant:outbound:echo:hello']);
  });

  test('routes replies through a channel registered before daemon start', async () => {
    const fixture = await createFixture();
    fixtures.push(fixture);

    const channel = createManualChannel('telegram');
    const daemon = createLinnsyDaemon({
      foundation: fixture.foundation,
      channels: [],
      executor: {
        execute(context) {
          return Promise.resolve({ status: 'completed', finalAnswer: `echo:${context.query}` });
        }
      },
      awaitTurnInHandler: true
    });
    daemon.channelRegistry.register(channel);

    await daemon.start();
    await channel.emit({
      messageId: 'local_1',
      platform: 'telegram',
      chatType: 'private',
      chatId: 'chat_1',
      text: 'hello',
      receivedAt: 10
    });
    await daemon.stop();

    expect(channel.sent.map((entry) => entry.payload.text)).toEqual(['echo:hello']);
  });

  test('routes phone terminal inbound messages into the bound conversation', async () => {
    const fixture = await createFixture();
    fixtures.push(fixture);

    const channel = createManualChannel('telegram');
    const daemon = createLinnsyDaemon({
      foundation: fixture.foundation,
      channels: [channel],
      executor: {
        execute(context) {
          return Promise.resolve({ status: 'completed', finalAnswer: `echo:${context.query}` });
        }
      },
      awaitTurnInHandler: true
    });

    await daemon.start();
    const binding = await daemon.terminalBindingService.getBinding();
    await channel.emit({
      messageId: 'local_phone_1',
      platform: 'telegram',
      chatType: 'private',
      chatId: 'real_phone_chat',
      text: 'hello from phone',
      receivedAt: 10
    });
    await daemon.stop();

    await expect(fixture.foundation.conversations.findBySessionKey('linnsy:main:telegram:private:real_phone_chat'))
      .resolves.toBeNull();
    const messages = await fixture.foundation.messages.listByConversation(binding.conversationId, { limit: 10 });
    expect(messages.messages.map((message) => ({
      role: message.role,
      text: message.text,
      platform: message.platform,
      chatType: message.chatType,
      chatId: message.chatId
    }))).toEqual([
      {
        role: 'user',
        text: 'hello from phone',
        platform: 'telegram',
        chatType: 'private',
        chatId: 'real_phone_chat'
      },
      {
        role: 'assistant',
        text: 'echo:hello from phone',
        platform: 'telegram',
        chatType: 'private',
        chatId: 'real_phone_chat'
      }
    ]);
  });

  test('ignores duplicate inbound provider messages without spawning a second run', async () => {
    const fixture = await createFixture();
    fixtures.push(fixture);

    let executeCount = 0;
    const executor: RunExecutorPort = {
      execute(context): Promise<RunOutcome> {
        executeCount += 1;
        return Promise.resolve({ status: 'completed', finalAnswer: `echo:${context.query}` });
      }
    };

    const channel = createManualChannel('telegram');
    const daemon = createLinnsyDaemon({
      foundation: fixture.foundation,
      channels: [channel],
      executor,
      awaitTurnInHandler: true
    });

    await daemon.start();
    await channel.emit({
      messageId: 'local_1',
      platform: 'telegram',
      chatType: 'private',
      chatId: 'chat_1',
      providerMessageId: 'provider_1',
      text: 'hello',
      receivedAt: 10
    });
    await channel.emit({
      messageId: 'local_2',
      platform: 'telegram',
      chatType: 'private',
      chatId: 'chat_1',
      providerMessageId: 'provider_1',
      text: 'hello replay',
      receivedAt: 11
    });
    await daemon.stop();

    expect(executeCount).toBe(1);
    expect(channel.sent.map((entry) => entry.payload.text)).toEqual(['echo:hello']);

    const conversations = await fixture.foundation.conversations.list({});
    const conversationId = conversations[0]?.conversationId;
    expect(conversationId).toBeDefined();
    if (conversationId === undefined) {
      throw new Error('conversation should exist');
    }
    const messages = await fixture.foundation.messages.listByConversation(conversationId, { limit: 10 });
    expect(messages.messages.map((m) => `${m.role}:${m.source}:${m.text ?? ''}`)).toEqual([
      'user:inbound:hello',
      'assistant:outbound:echo:hello'
    ]);
  });

  test('lets a fake telegram chat pair once before normal routing', async () => {
    const fixture = await createFixture();
    fixtures.push(fixture);

    let executeCount = 0;
    const executor: RunExecutorPort = {
      execute(context): Promise<RunOutcome> {
        executeCount += 1;
        return Promise.resolve({ status: 'completed', finalAnswer: `echo:${context.query}` });
      }
    };
    const authGuard = createAuthorizationGuard({
      globalAllowAll: false,
      platformPolicies: {
        telegram: { allowAll: false, allowlist: [] }
      },
      pairingStore: new SqlitePairingStore(fixture.foundation.db),
      clock: fixture.foundation.clock,
      logger: fixture.foundation.logger,
      codeFactory: () => 'ABCDEFGH'
    });
    const generated = await authGuard.generatePairingCode?.({
      platform: 'telegram',
      chatId: 'chat_1',
      ttlMs: 600000
    });
    expect(generated?.code).toBe('ABCDEFGH');
    expect(generated?.expiresAt).toBeGreaterThan(Date.now());

    const channel = createManualChannel('telegram');
    const daemon = createLinnsyDaemon({
      foundation: fixture.foundation,
      channels: [channel],
      executor,
      awaitTurnInHandler: true,
      authGuard
    });

    await daemon.start();
    await channel.emit({
      messageId: 'local_1',
      platform: 'telegram',
      chatType: 'private',
      chatId: 'chat_1',
      userId: 'user_1',
      providerMessageId: 'provider_1',
      text: 'before pair',
      receivedAt: 10
    });
    await channel.emit({
      messageId: 'local_2',
      platform: 'telegram',
      chatType: 'private',
      chatId: 'chat_1',
      userId: 'user_1',
      providerMessageId: 'provider_2',
      text: '/pair ABCDEFGH',
      receivedAt: 11
    });
    await channel.emit({
      messageId: 'local_3',
      platform: 'telegram',
      chatType: 'private',
      chatId: 'chat_1',
      userId: 'user_1',
      providerMessageId: 'provider_3',
      text: 'after pair',
      receivedAt: 12
    });
    await daemon.stop();

    expect(executeCount).toBe(1);
    expect(channel.sent.map((entry) => entry.payload.text)).toEqual([
      'Pairing complete.',
      'echo:after pair'
    ]);
  });

});

function createCapturingSpawner(spawns: SpawnOptions[]): RunSpawnerPort {
  return {
    spawnDetached(options: SpawnOptions): Promise<SpawnResult> {
      spawns.push(options);
      return Promise.resolve({ runId: `run_${spawns.length.toString()}`, conversationId: options.conversationId });
    },
    peek() {
      return Promise.resolve(null);
    },
    cancel() {
      return Promise.resolve();
    },
    waitForTerminal() {
      return Promise.resolve({
        runId: 'run_terminal',
        type: 'completed',
        outcome: { status: 'completed' }
      });
    },
    findActiveByConversation() {
      return Promise.resolve(null);
    },
    drain() {
      return Promise.resolve();
    },
    recoverOnBoot() {
      return Promise.resolve({ recovered: 0, abandoned: 0 });
    }
  };
}
