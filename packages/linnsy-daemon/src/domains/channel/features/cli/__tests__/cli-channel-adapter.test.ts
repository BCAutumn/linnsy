import { PassThrough } from 'node:stream';
import { describe, expect, test } from 'vitest';

import { LINNSY_ERROR_CODES } from '../../../../../shared/errors.js';
import type { LinnsyMessage } from '../../../../../shared/messaging.js';
import { CLI_PLATFORM, createCliChannelAdapter } from '../cli-channel-adapter.js';

interface MemoryLogger {
  records: Array<{ level: 'info' | 'warn' | 'error'; message: string; metadata?: Record<string, unknown> }>;
  info: (message: string, metadata?: Record<string, unknown>) => void;
  warn: (message: string, metadata?: Record<string, unknown>) => void;
  error: (message: string, metadata?: Record<string, unknown>) => void;
}

function createMemoryLogger(): MemoryLogger {
  const logger: MemoryLogger = {
    records: [],
    info: (message, metadata) => logger.records.push({ level: 'info', message, ...(metadata === undefined ? {} : { metadata }) }),
    warn: (message, metadata) => logger.records.push({ level: 'warn', message, ...(metadata === undefined ? {} : { metadata }) }),
    error: (message, metadata) => logger.records.push({ level: 'error', message, ...(metadata === undefined ? {} : { metadata }) })
  };
  return logger;
}

function collectStdout(stream: PassThrough): string[] {
  const chunks: string[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf8')));
  return chunks;
}

async function flushQueue(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe('cli channel adapter', () => {
  test('parses stdin lines into LinnsyMessage and dispatches them', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const messages: LinnsyMessage[] = [];
    let counter = 0;

    const adapter = createCliChannelAdapter({
      stdin,
      stdout,
      clock: { now: () => 1_000 },
      messageIdFactory: () => `msg_${(counter += 1).toString()}`
    });

    await adapter.start((message) => {
      messages.push(message);
      return Promise.resolve();
    });

    stdin.write('hello\n');
    stdin.write('world\r\n');
    stdin.write('\n');
    await flushQueue();

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      messageId: 'msg_1',
      platform: CLI_PLATFORM,
      chatType: 'private',
      chatId: 'local',
      text: 'hello',
      receivedAt: 1_000
    });
    expect(messages[1]?.text).toBe('world');

    await adapter.stop();
  });

  test('refuses concurrent start and reports unstarted health', async () => {
    const adapter = createCliChannelAdapter({
      stdin: new PassThrough(),
      stdout: new PassThrough()
    });

    await expect(adapter.healthcheck()).resolves.toMatchObject({ ok: false, detail: 'channel not started' });

    await adapter.start(() => Promise.resolve());
    await expect(adapter.start(() => Promise.resolve())).rejects.toMatchObject({
      code: LINNSY_ERROR_CODES.CHANNEL_NOT_STARTED
    });
    await expect(adapter.healthcheck()).resolves.toMatchObject({ ok: true });
    await adapter.stop();
  });

  test('renders outbound text and attachments line by line', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const chunks = collectStdout(stdout);
    const adapter = createCliChannelAdapter({ stdin, stdout, outboundPrefix: '> ' });
    await adapter.start(() => Promise.resolve());

    const sendResult = await adapter.send(
      { platform: CLI_PLATFORM, chatType: 'private', chatId: 'local' },
      {
        text: 'line one\nline two',
        attachments: [{ kind: 'file', uri: 'file:///tmp/a.txt', filename: 'a.txt' }]
      }
    );

    expect(sendResult.delivery).toBe('sent');
    expect(sendResult.providerMessageId).toMatch(/^cli_/u);

    await adapter.stop();
    const output = chunks.join('');
    expect(output).toBe('> line one\n> line two\n> [attachment:file] a.txt\n');
  });

  test('logs handler errors instead of crashing', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const logger = createMemoryLogger();
    const adapter = createCliChannelAdapter({ stdin, stdout, logger });

    await adapter.start(() => Promise.reject(new Error('boom')));

    stdin.write('crashy line\n');
    await flushQueue();

    const failures = logger.records.filter((entry) => entry.level === 'error');
    expect(failures.length).toBe(1);
    expect(failures[0]?.message).toBe('cli-channel handler failed');

    await adapter.stop();
  });

  test('stop flushes pending handlers before resolving', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const adapter = createCliChannelAdapter({ stdin, stdout });

    let release: (() => void) | undefined;
    const inflight = new Promise<void>((resolve) => {
      release = resolve;
    });
    let handlerCompleted = false;

    await adapter.start(async () => {
      await inflight;
      handlerCompleted = true;
    });

    stdin.write('slow\n');
    await flushQueue();

    const stopPromise = adapter.stop();
    if (release !== undefined) {
      release();
    }
    await stopPromise;

    expect(handlerCompleted).toBe(true);
  });

  test('send after stop throws CHANNEL_NOT_STARTED', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const adapter = createCliChannelAdapter({ stdin, stdout });
    await adapter.start(() => Promise.resolve());
    await adapter.stop();

    await expect(
      adapter.send(
        { platform: CLI_PLATFORM, chatType: 'private', chatId: 'local' },
        { text: 'hi' }
      )
    ).rejects.toMatchObject({ code: LINNSY_ERROR_CODES.CHANNEL_NOT_STARTED });
  });

  test('send before start throws CHANNEL_NOT_STARTED', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const adapter = createCliChannelAdapter({ stdin, stdout });

    await expect(
      adapter.send(
        { platform: CLI_PLATFORM, chatType: 'private', chatId: 'local' },
        { text: 'hi' }
      )
    ).rejects.toMatchObject({ code: LINNSY_ERROR_CODES.CHANNEL_NOT_STARTED });
  });
});
