import { join } from 'node:path';

import type { LinnsyConfig } from '../../config/schema.js';
import { createLinnsyPathManager } from '../../config/path-manager.js';
import { bootChannelAdapters, type ChannelBootFailure } from './channel-boot.js';
import {
  createRuntimeEventHub,
  type RuntimeEventHubPort
} from '../../domains/observability/features/event-hub/event-hub.js';
import { createLinnsyAgentRegistry } from '../../domains/agent-run/features/agents/registry/registry.js';
import { linnsyMainPrompt } from '../../domains/agent-run/features/agents/linnsy-main/prompt.js';
import { createCodexExecDispatcher } from '../../domains/task/features/external-dispatch/codex/codex-exec-dispatcher.js';
import { createCodexSessionBridge } from '../../domains/task/features/external-dispatch/codex/codex-session-bridge.js';
import { createRoutingExternalAgentDispatcher } from '../../domains/task/features/external-dispatch/routing-dispatcher.js';
import type { HttpServerPort } from '../http/hono-server.js';
import { createInternalSubAgentRunner } from '../../domains/agent-run/features/internal-subagent/runner.js';
import { createNotificationLayer } from '../../domains/conversation/features/notification/notification-layer.js';
import { FileCronTickLock } from '../../domains/cron/features/scheduler/file-lock.js';
import { createCronScheduler } from '../../domains/cron/features/scheduler/scheduler.js';
import { createConversationManagementService } from '../../domains/conversation/features/management/conversation-management-service.js';
import { createLinnsyRunSpawner } from '../../domains/agent-run/features/run-spawner/run-spawner.js';
import { createLinnkitGraphRunExecutor } from '../../domains/agent-run/features/run-executor/linnkit-graph-executor.js';
import { createSessionRouter } from '../../domains/conversation/features/session-routing/session-router.js';
import { createSystemPromptAssembler } from '../../domains/agent-run/features/system-prompt/system-prompt-assembler.js';
import { createTerminalBindingService } from '../../domains/desktop-integration/features/terminal-binding/terminal-binding-service.js';
import { ensureDefaultMemoryItems } from '../../domains/memory/features/default-items/functions/default-memory-items.js';
import { createWorkspaceManager } from '../../domains/task/features/workspace/workspace-manager.js';
import type { LoggerPort } from '../../shared/ports.js';
import { createLinnsyDaemon, type LinnsyDaemon } from './daemon.js';
import {
  createLinnsyRuntimeFoundation,
  type LinnsyRuntimeFoundation
} from './foundation.js';
import { createOptionalHttpServer } from './local-daemon-http.js';
import { createProductionToolRuntime } from './local-daemon-tools.js';

export interface CreateLocalDaemonStackOptions {
  config: LinnsyConfig;
  logger: LoggerPort;
  env?: Record<string, string | undefined>;
  cliOutboundPrefix?: string;
}

export interface LocalDaemonStack {
  readonly foundation: LinnsyRuntimeFoundation;
  readonly daemon: LinnsyDaemon;
  readonly httpServer: HttpServerPort | null;
  start(): Promise<void>;
  stop(): Promise<void>;
  dispose(): void;
}

export function createLocalDaemonStack(options: CreateLocalDaemonStackOptions): LocalDaemonStack {
  const env = options.env ?? process.env;
  const foundation = createLinnsyRuntimeFoundation(options.config, { logger: options.logger });
  const registry = createLinnsyAgentRegistry();
  const pathManager = createLinnsyPathManager({
    linnsyHome: options.config.home,
    ...(options.config.workspace?.root === undefined ? {} : { taskWorkspaceRoot: options.config.workspace.root }),
    env
  });
  const workspace = createWorkspaceManager({ root: pathManager.taskWorkspaceRoot });
  const { adapters: channels, desktopBus, failures: channelBootFailures } = bootChannelAdapters({
    config: options.config,
    logger: options.logger,
    env,
    cliOutboundPrefix: options.cliOutboundPrefix ?? '> '
  });
  warnChannelBootFailures(channelBootFailures, options.logger);

  const events = createRuntimeEvents(foundation);
  const sessionRouter = createSessionRouter({
    conversations: foundation.conversations,
    clock: foundation.clock
  });
  const systemPromptAssembler = createSystemPromptAssembler({ clock: foundation.clock });
  const terminalBindingService = createTerminalBindingService({
    bindings: foundation.terminalBindings,
    conversations: foundation.conversations,
    sessionRouter,
    clock: foundation.clock,
    logger: options.logger
  });
  const notificationLayer = createNotificationLayer({
    channels,
    messages: foundation.messages,
    taskTracker: foundation.taskTracker,
    clock: foundation.clock,
    logger: options.logger,
    events
  });
  const dispatcher = createRoutingExternalAgentDispatcher({
    taskTracker: foundation.taskTracker,
    routes: {
      delegate_to_codex: createCodexExecDispatcher({
        taskTracker: foundation.taskTracker
      })
    }
  });
  const codexSessionBridge = createCodexSessionBridge();
  const spawnerRef: { current?: ReturnType<typeof createLinnsyRunSpawner> } = {};
  const internalRunner = createInternalSubAgentRunner({
    taskTracker: foundation.taskTracker,
    conversations: foundation.conversations,
    spawner: () => {
      if (spawnerRef.current === undefined) {
        throw new Error('Internal subagent runner started before run spawner was bound');
      }
      return spawnerRef.current;
    },
    maxConcurrency: options.config.runtime?.internal_subagent?.max_concurrency ?? 10,
    clock: foundation.clock,
    events
  });
  const toolRuntime = createProductionToolRuntime({
    foundation,
    registry,
    workspace,
    dispatcher,
    codexSessionBridge,
    internalRunner,
    notificationLayer,
    pathManager,
    events
  });
  const conversationManagement = createConversationManagementService({
    conversations: foundation.conversations,
    terminalBinding: terminalBindingService,
    systemPromptAssembler,
    clock: foundation.clock
  });
  const executor = createLinnkitGraphRunExecutor({
    foundation,
    systemPromptAssembler,
    toolRuntime,
    logger: options.logger,
    events
  });
  const spawner = createLinnsyRunSpawner({
    registry,
    conversations: foundation.conversations,
    runRegistry: foundation.runRegistry,
    executor,
    auditPort: foundation.auditPort,
    clock: foundation.clock,
    logger: options.logger,
    events,
    toolSchemaSource: toolRuntime
  });
  spawnerRef.current = spawner;

  const cronScheduler = createCronScheduler({
    store: foundation.cronStore,
    spawner,
    notification: notificationLayer,
    messages: foundation.messages,
    terminalBinding: terminalBindingService,
    lock: new FileCronTickLock(join(options.config.home, 'cron', '.tick.lock')),
    tickIntervalMs: options.config.cron.tick_interval_ms,
    clock: foundation.clock,
    logger: options.logger,
    events
  });
  const daemon = createLinnsyDaemon({
    foundation,
    channels,
    executor,
    spawner,
    registry,
    sessionRouter,
    systemPromptAssembler,
    notificationLayer,
    terminalBindingService,
    cronScheduler,
    events
  });
  const httpServer = createOptionalHttpServer({
    config: options.config,
    env,
    foundation,
    registry,
    daemon,
    desktopBus,
    events,
    systemPromptAssembler,
    conversationManagement,
    codexSessionBridge
  });

  return createStartableStack({ foundation, daemon, httpServer });
}

function createRuntimeEvents(foundation: LinnsyRuntimeFoundation): RuntimeEventHubPort {
  return createRuntimeEventHub({
    now: () => foundation.clock.now(),
    initialSeq: foundation.eventStore.readMaxSeq(),
    persistence: foundation.eventStore,
    history: foundation.eventStore
  });
}

function createStartableStack(input: {
  foundation: LinnsyRuntimeFoundation;
  daemon: LinnsyDaemon;
  httpServer: HttpServerPort | null;
}): LocalDaemonStack {
  let httpStarted = false;
  let daemonStarted = false;

  return {
    foundation: input.foundation,
    daemon: input.daemon,
    httpServer: input.httpServer,
    async start(): Promise<void> {
      try {
        await ensureDefaultMemoryItems(input.foundation.memoryStore, linnsyMainPrompt);
        await input.httpServer?.start();
        httpStarted = input.httpServer !== null;
        await input.daemon.start();
        daemonStarted = true;
      } catch (error: unknown) {
        await stopStartedComponents({
          daemon: input.daemon,
          httpServer: input.httpServer,
          daemonStarted,
          httpStarted
        });
        throw error;
      }
    },
    async stop(): Promise<void> {
      await stopStartedComponents({
        daemon: input.daemon,
        httpServer: input.httpServer,
        daemonStarted,
        httpStarted
      });
      daemonStarted = false;
      httpStarted = false;
    },
    dispose(): void {
      input.foundation.dispose();
    }
  };
}

async function stopStartedComponents(input: {
  daemon: LinnsyDaemon;
  httpServer: HttpServerPort | null;
  daemonStarted: boolean;
  httpStarted: boolean;
}): Promise<void> {
  if (input.daemonStarted) {
    await input.daemon.stop();
  }
  if (input.httpStarted) {
    await input.httpServer?.stop();
  }
}

function warnChannelBootFailures(failures: ChannelBootFailure[], logger: LoggerPort): void {
  for (const failure of failures) {
    // 可选通道降级不应阻断 daemon 主体启动；这里补一条 CLI 可见的汇总日志。
    logger.warn(`channel '${failure.channelId}' did not start: ${failure.reason}`, {
      channelId: failure.channelId
    });
  }
}
