import { randomUUID } from 'node:crypto';

import type { ToolRuntimePort } from '@linnlabs/linnkit/runtime-kernel';

import type { ClockPort, LoggerPort } from '../../shared/ports.js';
import { LinnsyError } from '../../shared/errors.js';
import type { MessageStorePort } from '../../persistence/stores/message/message-store-port.js';

import { createAuthGuardStub } from '../../domains/channel/features/authorization/auth-guard-stub.js';
import type { AuthorizationPort } from '../../domains/channel/features/authorization/types.js';
import type { ChannelAdapterPort, InboundHandler } from '../../domains/channel/definitions/types.js';
import {
  createChannelAdapterRegistry,
  type ChannelAdapterRegistryPort
} from '../../domains/channel/features/registry/channel-adapter-registry.js';
import { createLinnsyAgentRegistry } from '../../domains/agent-run/features/agents/registry/registry.js';
import { LINNSY_MAIN_AGENT_ID } from '../../domains/agent-run/features/agents/index.js';
import type { LinnsyAgentRegistryPort } from '../../domains/agent-run/features/agents/registry/types.js';
import type { RunExecutorPort, RunSpawnerPort } from '../../domains/agent-run/features/run-spawner/types.js';
import { createLinnsyRunSpawner } from '../../domains/agent-run/features/run-spawner/run-spawner.js';
import { createWakeOnTaskTransition } from '../../domains/agent-run/features/run-spawner/wake-on-task-transition.js';
import { createSessionRouter } from '../../domains/conversation/features/session-routing/session-router.js';
import type { SessionRouterPort } from '../../domains/conversation/features/session-routing/types.js';
import {
  createSystemPromptAssembler
} from '../../domains/agent-run/features/system-prompt/system-prompt-assembler.js';
import type { SystemPromptAssemblerPort } from '../../domains/agent-run/features/system-prompt/types.js';
import type { LinnsyRuntimeFoundation } from './foundation.js';
import type { CronSchedulerPort } from '../../domains/cron/features/scheduler/definitions/types.js';
import { createNotificationLayer } from '../../domains/conversation/features/notification/notification-layer.js';
import type { LinnsyNotificationLayer } from '../../domains/conversation/features/notification/types.js';
import type { RuntimeEventHubPort } from '../../domains/observability/features/event-hub/event-hub.js';
import {
  createTerminalBindingService,
  type TerminalBindingServicePort
} from '../../domains/desktop-integration/features/terminal-binding/terminal-binding-service.js';
import { handleTurn } from '../orchestration/turn-handler.js';
import { startDaemonChannels, stopDaemonChannels } from './wiring/channel-wiring.js';

export interface CreateLinnsyDaemonOptions {
  foundation: LinnsyRuntimeFoundation;
  channels: ChannelAdapterPort[];
  executor: RunExecutorPort;
  authGuard?: AuthorizationPort;
  registry?: LinnsyAgentRegistryPort;
  sessionRouter?: SessionRouterPort;
  spawner?: RunSpawnerPort;
  systemPromptAssembler?: SystemPromptAssemblerPort;
  notificationLayer?: LinnsyNotificationLayer;
  terminalBindingService?: TerminalBindingServicePort;
  cronScheduler?: CronSchedulerPort;
  defaultDefinitionKey?: string;
  clock?: ClockPort;
  logger?: LoggerPort;
  inboundIdFactory?: () => string;
  outboundIdFactory?: () => string;
  events?: RuntimeEventHubPort;
  toolRuntime?: ToolRuntimePort;
  /** When true, daemon waits for each turn (spawn + reply) before returning from inbound handler. Useful for tests. */
  awaitTurnInHandler?: boolean;
}

export interface LinnsyDaemon {
  readonly registry: LinnsyAgentRegistryPort;
  readonly sessionRouter: SessionRouterPort;
  readonly spawner: RunSpawnerPort;
  readonly authGuard: AuthorizationPort;
  readonly channelRegistry: ChannelAdapterRegistryPort;
  readonly systemPromptAssembler: SystemPromptAssemblerPort;
  readonly notificationLayer: LinnsyNotificationLayer;
  readonly terminalBindingService: TerminalBindingServicePort;
  readonly cronScheduler?: CronSchedulerPort;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createLinnsyDaemon(options: CreateLinnsyDaemonOptions): LinnsyDaemon {
  const clock = options.clock ?? options.foundation.clock;
  const logger = options.logger ?? options.foundation.logger;
  const inboundIdFactory = options.inboundIdFactory ?? defaultMessageIdFactory('in');
  const outboundIdFactory = options.outboundIdFactory ?? defaultMessageIdFactory('out');

  const registry = options.registry ?? createLinnsyAgentRegistry();
  const sessionRouter = options.sessionRouter ?? createSessionRouter({
    conversations: options.foundation.conversations,
    clock
  });
  const systemPromptAssembler = options.systemPromptAssembler ?? createSystemPromptAssembler({ clock });
  const spawner = options.spawner ?? createLinnsyRunSpawner({
    registry,
    conversations: options.foundation.conversations,
    runRegistry: options.foundation.runRegistry,
    executor: options.executor,
    auditPort: options.foundation.auditPort,
    clock,
    logger,
    ...(options.events === undefined ? {} : { events: options.events }),
    ...(options.toolRuntime === undefined ? {} : { toolSchemaSource: options.toolRuntime })
  });
  const authGuard = options.authGuard ?? createAuthGuardStub({ logger });
  const defaultDefinitionKey = options.defaultDefinitionKey ?? LINNSY_MAIN_AGENT_ID;
  const messages: MessageStorePort = options.foundation.messages;
  const awaitTurnInHandler = options.awaitTurnInHandler === true;

  const channelRegistry = createChannelAdapterRegistry(options.channels);
  const terminalBindingService = options.terminalBindingService ?? createTerminalBindingService({
    bindings: options.foundation.terminalBindings,
    conversations: options.foundation.conversations,
    sessionRouter,
    clock,
    logger
  });

  const notificationLayer = options.notificationLayer ?? createNotificationLayer({
    channels: channelRegistry,
    messages,
    taskTracker: options.foundation.taskTracker,
    clock,
    logger,
    outboundIdFactory,
    ...(options.events === undefined ? {} : { events: options.events })
  });
  options.foundation.attachTaskWakeHook(createWakeOnTaskTransition({
    spawner,
    runRegistry: options.foundation.runRegistry,
    notification: notificationLayer,
    logger,
    ...(options.events === undefined ? {} : { events: options.events })
  }));

  const inboundHandler: InboundHandler = async (message) => {
    const turn = handleTurn({
      message,
      authGuard,
      sessionRouter,
      spawner,
      notificationLayer,
      terminalBindingService,
      messages,
      defaultDefinitionKey,
      logger,
      inboundIdFactory,
      ...(options.events === undefined ? {} : { events: options.events })
    });
    if (awaitTurnInHandler) {
      await turn;
    } else {
      turn.catch((error: unknown) => {
        logger.error('linnsy daemon turn failed asynchronously', {
          messageId: message.messageId,
          error: serializeError(error)
        });
      });
    }
  };

  return {
    registry,
    sessionRouter,
    spawner,
    authGuard,
    channelRegistry,
    systemPromptAssembler,
    notificationLayer,
    terminalBindingService,
    ...(options.cronScheduler === undefined ? {} : { cronScheduler: options.cronScheduler }),
    async start(): Promise<void> {
      await startDaemonChannels({
        channelRegistry,
        ...(options.cronScheduler === undefined ? {} : { cronScheduler: options.cronScheduler }),
        inboundHandler,
        logger,
        terminalBindingService
      });
    },
    async stop(): Promise<void> {
      await stopDaemonChannels({
        channelRegistry,
        ...(options.cronScheduler === undefined ? {} : { cronScheduler: options.cronScheduler }),
        logger,
        spawner,
        systemPromptAssembler
      });
    }
  };
}

function defaultMessageIdFactory(prefix: string): () => string {
  return () => `${prefix}_${randomUUID()}`;
}

function serializeError(error: unknown): { message: string; code?: string } {
  if (error instanceof LinnsyError) {
    return { message: error.message, code: error.code };
  }
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: String(error) };
}
