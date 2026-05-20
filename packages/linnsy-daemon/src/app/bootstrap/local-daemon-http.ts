import type { LinnsyConfig } from '../../config/schema.js';
import { createDashboardReadModel } from '../../domains/observability/features/dashboard/dashboard-read-model.js';
import type { DesktopMessageBusPort } from '../../domains/channel/features/desktop/desktop-message-bus.js';
import type { ConversationManagementPort } from '../../domains/conversation/features/management/conversation-management-service.js';
import { createCodexProbe } from '../../domains/task/features/external-dispatch/codex/codex-probe.js';
import type { CodexSessionBridgePort } from '../../domains/task/features/external-dispatch/codex/codex-session-bridge.js';
import { createHonoHttpServer, type HttpServerPort } from '../http/hono-server.js';
import type { RuntimeEventHubPort } from '../../domains/observability/features/event-hub/event-hub.js';
import type { LinnsyAgentRegistryPort } from '../../domains/agent-run/features/agents/registry/types.js';
import type { SystemPromptAssemblerPort } from '../../domains/agent-run/features/system-prompt/types.js';
import type { LinnsyDaemon } from './daemon.js';
import type { LinnsyRuntimeFoundation } from './foundation.js';

export interface CreateOptionalHttpServerOptions {
  config: LinnsyConfig;
  env: Record<string, string | undefined>;
  foundation: LinnsyRuntimeFoundation;
  registry: LinnsyAgentRegistryPort;
  daemon: LinnsyDaemon;
  desktopBus: DesktopMessageBusPort | null;
  events: RuntimeEventHubPort;
  systemPromptAssembler: SystemPromptAssemblerPort;
  conversationManagement: ConversationManagementPort;
  codexSessionBridge: CodexSessionBridgePort;
}

export function createOptionalHttpServer(options: CreateOptionalHttpServerOptions): HttpServerPort | null {
  if (!options.config.channels.web.enabled) {
    return null;
  }

  return createHonoHttpServer({
    bind: options.config.channels.web.bind,
    bearerToken: readRequiredEnv(options.env, options.config.channels.web.bearer_env),
    taskTracker: options.foundation.taskTracker,
    uiPreferencesStore: options.foundation.uiPreferencesStore,
    modelSettingsStore: options.foundation.modelSettingsStore,
    modelSecretsStore: options.foundation.modelSecretsStore,
    modelRegistry: options.foundation.modelRegistry,
    memoryStore: options.foundation.memoryStore,
    agentRegistry: options.registry,
    afterMemoryMutation: () => {
      options.systemPromptAssembler.clear();
    },
    ...(options.desktopBus === null ? {} : { desktopBus: options.desktopBus }),
    codexProbe: createCodexProbe(),
    codexSessionBridge: options.codexSessionBridge,
    events: options.events,
    readModel: createDashboardReadModel({
      conversations: options.foundation.conversations,
      messages: options.foundation.messages,
      tasks: options.foundation.taskTracker,
      events: options.events,
      eventsHistory: options.foundation.eventStore
    }),
    conversationCreator: options.daemon.sessionRouter,
    conversationManagement: options.conversationManagement,
    terminalBinding: options.daemon.terminalBindingService,
    cronStore: options.foundation.cronStore,
    messageStore: options.foundation.messages,
    clock: options.foundation.clock
  });
}

function readRequiredEnv(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}
