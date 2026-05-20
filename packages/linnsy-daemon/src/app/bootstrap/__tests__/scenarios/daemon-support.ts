import { rm } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { afterEach } from 'vitest';

import { createTempLinnsyHome } from '../../../../../__tests__/harness/temp-home.js';
import type { LinnsyConfig } from '../../../../config/schema.js';
import { LINNSY_ERROR_CODES } from '../../../../shared/errors.js';
import { SqlitePairingStore } from '../../../../persistence/stores/pairing/sqlite-pairing-store.js';
import type { LoggerPort } from '../../../../shared/ports.js';
import type { CronSchedulerPort } from '../../../../domains/cron/features/scheduler/definitions/types.js';
import {
  CLI_PLATFORM,
  createCliChannelAdapter
} from '../../../../domains/channel/features/cli/cli-channel-adapter.js';
import type { ChannelAdapterPort, InboundHandler } from '../../../../domains/channel/definitions/types.js';
import { createAuthorizationGuard } from '../../../../domains/channel/features/authorization/authorization-guard.js';
import { createLinnsyDaemon } from '../../daemon.js';
import { createLinnsyRuntimeFoundation } from '../../foundation.js';
import type { LinnsyRuntimeFoundation } from '../../foundation.js';
import type { RunExecutorPort, RunOutcome, RunSpawnerPort } from '../../../../domains/agent-run/features/run-spawner/types.js';
import { LINNSY_FENCE_KINDS } from '../../../../domains/agent-run/features/context-engineering/fences.js';
import { consumePendingContextFences } from '../../../../domains/agent-run/features/context-engineering/pending-interjections.js';
import type { LinnsyMessage, OutboundPayload, SendTarget } from '../../../../shared/messaging.js';

export interface DaemonFixture {
  foundation: LinnsyRuntimeFoundation;
  cleanup(): Promise<void>;
  stdin: PassThrough;
  stdout: PassThrough;
  stdoutChunks: string[];
  logger: { records: Array<{ level: string; message: string }> };
}

export function minimalConfig(home: string): LinnsyConfig {
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
    auth: {
      global_all: false,
      pairing: { code_ttl_ms: 600000, max_attempts: 5 }
    },
    cron: { tick_interval_ms: 60000, default_miss_grace_ms: 7200000 },
    memory: { on_pre_compress_provider: 'builtin' },
    mcp: { server: { enabled: true, transport: 'stdio' }, clients: [] }
  };
}

export async function createFixture(): Promise<DaemonFixture> {
  const home = await createTempLinnsyHome();
  const records: Array<{ level: string; message: string }> = [];
  const logger: LoggerPort = {
    info: (message) => records.push({ level: 'info', message }),
    warn: (message) => records.push({ level: 'warn', message }),
    error: (message) => records.push({ level: 'error', message })
  };
  const foundation = createLinnsyRuntimeFoundation(minimalConfig(home), {
    logger,
    env: { LINNSY_OPENAI_KEY: 'test-key' }
  });

  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stdoutChunks: string[] = [];
  stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk.toString('utf8')));

  return {
    foundation,
    cleanup: async () => {
      foundation.dispose();
      await rm(home, { recursive: true, force: true });
    },
    stdin,
    stdout,
    stdoutChunks,
    logger: { records }
  };
}

export const fixtures: DaemonFixture[] = [];
afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    if (fixture !== undefined) {
      await fixture.cleanup();
    }
  }
});

export async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}


export function createManualChannel(platform: 'telegram'): ChannelAdapterPort & {
  sent: Array<{ target: SendTarget; payload: OutboundPayload }>;
  emit(message: LinnsyMessage): Promise<void>;
} {
  let handler: InboundHandler | null = null;
  const sent: Array<{ target: SendTarget; payload: OutboundPayload }> = [];
  return {
    platform,
    start(nextHandler) {
      handler = nextHandler;
      return Promise.resolve();
    },
    stop() {
      handler = null;
      return Promise.resolve();
    },
    send(target, payload) {
      sent.push({ target, payload });
      return Promise.resolve({ delivery: 'sent', providerMessageId: `sent_${sent.length.toString()}` });
    },
    healthcheck() {
      return Promise.resolve({ ok: handler !== null });
    },
    async emit(message) {
      if (handler === null) {
        throw new Error('manual channel not started');
      }
      await handler(message);
    },
    sent
  };
}

export function readCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code = error.code;
  return typeof code === 'string' ? code : undefined;
}

export { PassThrough, LINNSY_ERROR_CODES, SqlitePairingStore, CLI_PLATFORM, createCliChannelAdapter, createAuthorizationGuard, createLinnsyDaemon, createLinnsyRuntimeFoundation, LINNSY_FENCE_KINDS, consumePendingContextFences };
export type { ChannelAdapterPort, InboundHandler, RunExecutorPort, RunOutcome, RunSpawnerPort, CronSchedulerPort, LinnsyRuntimeFoundation, LinnsyMessage, OutboundPayload, SendTarget };
