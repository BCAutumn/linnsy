import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChannelAdapterPort, InboundHandler } from '../../src/domains/channel/definitions/types.js';
import { describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../harness/temp-home.js';
import type { LinnsyConfig } from '../../src/config/schema.js';
import type { LinnsyMessage, OutboundPayload, SendTarget } from '../../src/shared/messaging.js';
import { createLinnsyDaemon } from '../../src/app/bootstrap/daemon.js';
import { createLinnsyRuntimeFoundation } from '../../src/app/bootstrap/foundation.js';
import { createLinnsyAgentRegistry } from '../../src/domains/agent-run/features/agents/registry/registry.js';
import { createNotificationLayer } from '../../src/domains/conversation/features/notification/notification-layer.js';
import { FileCronTickLock } from '../../src/domains/cron/features/scheduler/file-lock.js';
import { createCronScheduler } from '../../src/domains/cron/features/scheduler/scheduler.js';
import { createLinnsyRunSpawner } from '../../src/domains/agent-run/features/run-spawner/run-spawner.js';
import { createTerminalBindingService } from '../../src/domains/desktop-integration/features/terminal-binding/terminal-binding-service.js';
import { createSessionRouter } from '../../src/domains/conversation/features/session-routing/session-router.js';
import type { RunExecutionContext, RunExecutorPort, RunOutcome } from '../../src/domains/agent-run/features/run-spawner/types.js';

describe('cron reminder end-to-end', () => {
  test('due cron run sends a proactive reminder once and does not load ordinary history', async () => {
    const home = await createTempLinnsyHome();
    const foundation = createLinnsyRuntimeFoundation(minimalConfig(home), {
      env: { LINNSY_OPENAI_KEY: 'test-key' },
      clock: { now: () => 10_000 }
    });

    try {
      const channel = createManualChannel('cli');
      const registry = createLinnsyAgentRegistry();
      const contexts: RunExecutionContext[] = [];
      const executor: RunExecutorPort = {
        execute(context): Promise<RunOutcome> {
          contexts.push(context);
          return Promise.resolve({
            status: 'completed',
            finalAnswer: context.metadata?.cronJobId === 'cron_1' ? 'drink water' : 'created reminder'
          });
        }
      };
      const spawner = createLinnsyRunSpawner({
        registry,
        conversations: foundation.conversations,
        runRegistry: foundation.runRegistry,
        executor,
        auditPort: foundation.auditPort,
        clock: foundation.clock,
        logger: foundation.logger,
        runIdFactory: createSequentialIdFactory('run')
      });
      const notificationLayer = createNotificationLayer({
        channels: [channel],
        messages: foundation.messages,
        clock: foundation.clock,
        logger: foundation.logger,
        outboundIdFactory: createSequentialIdFactory('out')
      });
      const sessionRouter = createSessionRouter({
        conversations: foundation.conversations,
        clock: foundation.clock
      });
      const terminalBindingService = createTerminalBindingService({
        bindings: foundation.terminalBindings,
        conversations: foundation.conversations,
        sessionRouter,
        clock: foundation.clock,
        logger: foundation.logger
      });
      const scheduler = createCronScheduler({
        store: foundation.cronStore,
        spawner,
        notification: notificationLayer,
        messages: foundation.messages,
        terminalBinding: terminalBindingService,
        lock: new FileCronTickLock(join(home, 'cron', '.tick.lock')),
        tickIntervalMs: 3_600_000,
        clock: foundation.clock,
        logger: foundation.logger,
        cronRunIdFactory: createSequentialIdFactory('cron_run')
      });
      const daemon = createLinnsyDaemon({
        foundation,
        channels: [channel],
        executor,
        spawner,
        registry,
        notificationLayer,
        sessionRouter,
        terminalBindingService,
        cronScheduler: scheduler,
        awaitTurnInHandler: true
      });

      await daemon.start();
      await channel.emit({
        messageId: 'inbound_1',
        platform: 'cli',
        chatType: 'private',
        chatId: 'local',
        providerMessageId: 'provider_in_1',
        text: '每天 9 点提醒我喝水',
        receivedAt: 1_000
      });

      const conversation = (await foundation.conversations.list({})).find((item) => item.platform === 'cli');
      if (conversation === undefined) {
        throw new Error('cli conversation should exist before cron tick');
      }
      await terminalBindingService.bindToConversation(conversation.conversationId, 'test');
      await foundation.cronStore.upsert({
        jobId: 'cron_1',
        enabled: true,
        schedule: { kind: 'one_shot', atMs: 10_000 },
        nextRunAt: 10_000,
        missGraceMs: 120_000,
        payload: {
          definitionKey: 'linnsy_main',
          query: '喝水'
        },
        createdAt: 2_000,
        updatedAt: 2_000
      });

      await scheduler.tick();
      await scheduler.tick();
      await daemon.stop();

      expect(channel.sent.map((entry) => entry.payload.text)).toEqual([
        'created reminder',
        'drink water'
      ]);
      expect(contexts.map((context) => context.definition.id)).toEqual([
        'linnsy_main',
        'linnsy_main'
      ]);
      expect(contexts[1]?.ephemeral).toEqual({ skipMemory: true, skipContextFiles: true });
      // 2026-05-05 拍板：一次性 cron 完成后保留 7 天再清理（X1 自适应展示用）
      await expect(foundation.cronStore.list()).resolves.toContainEqual(expect.objectContaining({
        jobId: 'cron_1',
        enabled: false
      }));
      const messages = await foundation.messages.listByConversation(conversation.conversationId, { limit: 10 });
      expect(messages.messages.map((message) => `${message.source}:${message.text ?? ''}`)).toEqual([
        'inbound:每天 9 点提醒我喝水',
        'outbound:created reminder',
        'outbound:drink water'
      ]);
    } finally {
      foundation.dispose();
      await rm(home, { recursive: true, force: true });
    }
  });
});

function createManualChannel(platform: 'cli'): ChannelAdapterPort & {
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
      return Promise.resolve({
        delivery: 'sent',
        providerMessageId: `provider_out_${sent.length.toString()}`
      });
    },
    healthcheck() {
      return Promise.resolve({ ok: handler !== null });
    },
    async emit(message) {
      if (handler === null) {
        throw new Error('manual channel is not started');
      }
      await handler(message);
    },
    sent
  };
}

function createSequentialIdFactory(prefix: string): () => string {
  let next = 0;
  return () => `${prefix}_${(next += 1).toString()}`;
}

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
    auth: {
      global_all: false,
      pairing: { code_ttl_ms: 600000, max_attempts: 5 }
    },
    cron: { tick_interval_ms: 60000, default_miss_grace_ms: 7200000 },
    memory: { on_pre_compress_provider: 'builtin' },
    mcp: { server: { enabled: true, transport: 'stdio' }, clients: [] }
  };
}
