import { rm } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, test } from 'vitest';

import type { LinnsyConfig } from '../../src/config/schema.js';
import {
  CLI_PLATFORM,
  createCliChannelAdapter,
  createLinnsyDaemon,
  createLinnsyRuntimeFoundation
} from '../../src/index.js';
import type { LinnsyRuntimeFoundation, RunExecutorPort, RunOutcome } from '../../src/index.js';
import { createTempLinnsyHome } from '../harness/temp-home.js';

const RTT_BUDGET_MS = 100;

function minimalConfig(home: string): LinnsyConfig {
  return {
    profile: 'test',
    home,
    llm: {
      default_provider: 'openai',
      defaults: {
        secretary: 'openai.gpt5',
        cron_summary: 'openai.gpt5',
        memory_consolidate: 'openai.gpt5'
      },
      providers: {
        openai: {
          api_protocol: 'openai_responses',
          api_key_env: 'LINNSY_OPENAI_KEY',
          models: { gpt5: { model_name: 'gpt-5' } }
        }
      }
    },
    channels: {
      cli: { enabled: true },
      web: { enabled: false, bind: '127.0.0.1:7700', bearer_env: 'LINNSY_WEB_BEARER' }
    },
    auth: { global_all: false, pairing: { code_ttl_ms: 600000, max_attempts: 5 } },
    cron: { tick_interval_ms: 60000, default_miss_grace_ms: 7200000 },
    memory: { on_pre_compress_provider: 'builtin' },
    mcp: { server: { enabled: true, transport: 'stdio' }, clients: [] }
  };
}

interface E2EFixture {
  foundation: LinnsyRuntimeFoundation;
  cleanup(): Promise<void>;
  stdin: PassThrough;
  stdout: PassThrough;
  stdoutChunks: string[];
}

async function createFixture(): Promise<E2EFixture> {
  const home = await createTempLinnsyHome();
  const foundation = createLinnsyRuntimeFoundation(minimalConfig(home), {
    env: { LINNSY_OPENAI_KEY: 'test-key' }
  });
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stdoutChunks: string[] = [];
  stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk.toString('utf8')));
  return {
    foundation,
    stdin,
    stdout,
    stdoutChunks,
    async cleanup() {
      foundation.dispose();
      await rm(home, { recursive: true, force: true });
    }
  };
}

const fixtures: E2EFixture[] = [];
afterEach(async () => {
  while (fixtures.length > 0) {
    const f = fixtures.pop();
    if (f !== undefined) {
      await f.cleanup();
    }
  }
});

describe('linnsy single-turn end-to-end (T1.8)', () => {
  test('CLI inbound -> mock LLM -> CLI outbound completes within RTT budget and lands in DB', async () => {
    const fixture = await createFixture();
    fixtures.push(fixture);

    const executor: RunExecutorPort = {
      execute(): Promise<RunOutcome> {
        return Promise.resolve({ status: 'completed', finalAnswer: 'mock-llm-reply' });
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

    const startedAt = Date.now();
    fixture.stdin.write('hi\n');
    await waitFor(() => fixture.stdoutChunks.join('').includes('mock-llm-reply'));
    const elapsedMs = Date.now() - startedAt;

    await daemon.stop();

    expect(elapsedMs).toBeLessThan(RTT_BUDGET_MS);
    expect(fixture.stdoutChunks.join('')).toContain('> mock-llm-reply');

    const conversations = await fixture.foundation.conversations.list({});
    const conversation = conversations.find((item) => item.platform === 'cli');
    if (conversation === undefined) {
      throw new Error('cli conversation should exist');
    }
    const conversationId = conversation.conversationId;

    const messages = await fixture.foundation.messages.listByConversation(conversationId, {
      limit: 10
    });
    expect(messages.messages.map((m) => `${m.role}:${m.source}:${m.text ?? ''}`)).toEqual([
      'user:inbound:hi',
      'assistant:outbound:mock-llm-reply'
    ]);

    const runs = await fixture.foundation.runRegistry.list({ limit: 10 });
    expect(runs.runs).toHaveLength(1);
    expect(runs.runs[0]?.status).toBe('completed');
    expect(runs.runs[0]?.conversationId).toBe(conversationId);
  });

  test('CLI platform constant guards exported wiring', () => {
    expect(CLI_PLATFORM).toBe('cli');
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 1_000, intervalMs = 5): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`waitFor exceeded ${String(timeoutMs)}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
