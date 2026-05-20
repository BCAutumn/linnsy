import { serve, type ServerType } from '@hono/node-server';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { WebSocketServer } from 'ws';

import type { UiPreferencesStorePort } from '../../domains/desktop-integration/persistence/ui-preferences/ui-preferences-store-port.js';
import type { MemoryProviderPort } from '../../domains/memory/persistence/memory-store-port.js';
import type { ModelSettingsStorePort } from '../../domains/llm/persistence/model-settings/model-settings-store-port.js';
import type { ModelSecretsStorePort } from '../../domains/llm/persistence/model-secrets/model-secrets-store-port.js';
import type { CronJobStorePort } from '../../domains/cron/persistence/cron-job-store-port.js';
import { createObservabilityWebApp } from '../../domains/observability/features/dashboard/web-api.js';
import type { ConversationCreatePort, DashboardReadModelPort } from '../../domains/observability/features/dashboard/types.js';
import type { LinnsyModelRegistryPort } from '../../domains/llm/features/model-registry/model-registry.js';
import type { MessageStorePort } from '../../persistence/stores/message/message-store-port.js';
import type { DesktopMessageBusPort } from '../../domains/channel/features/desktop/desktop-message-bus.js';
import type { RuntimeEventHubPort } from '../../domains/observability/features/event-hub/event-hub.js';
import type { TerminalBindingServicePort } from '../../domains/desktop-integration/features/terminal-binding/terminal-binding-service.js';
import type { ConversationManagementPort } from '../../domains/conversation/features/management/conversation-management-service.js';
import type { TaskTrackerPort } from '../../domains/task/ports/task-tracker-port.js';
import { externalUpdateSchema, toExternalUpdate } from '../../domains/task/definitions/task.js';
import type { LinnsyAgentRegistryPort } from '../../domains/agent-run/features/agents/registry/types.js';
import { systemClock, type ClockPort } from '../../shared/ports.js';
import { createConversationRoutes } from '../../domains/conversation/features/http/conversation-routes.js';
import { createCronRoutes } from '../../domains/cron/features/http/cron-routes.js';
import { createMemoryRoutes } from '../../domains/memory/features/http/memory-routes.js';
import { createDesktopRoutes } from '../../domains/channel/features/desktop/http/desktop-routes.js';
import { createTerminalBindingRoutes } from '../../domains/desktop-integration/features/terminal-binding/http/terminal-binding-routes.js';
import { createStreamRoutes } from '../../domains/observability/features/event-stream/stream-routes.js';
import { createUiPreferencesRoutes } from '../../domains/desktop-integration/features/ui-preferences/http/ui-preferences-routes.js';
import { buildSystemPromptPreview } from '../../domains/agent-run/features/system-prompt/system-prompt-preview.js';
import { createModelSettingsRoutes } from '../../domains/llm/features/model-settings/http/model-settings-routes.js';
import { createApplicationConnectionsRoutes } from '../../domains/desktop-integration/features/application-connections/http/application-connections-routes.js';
import { createCodexSessionRoutes } from '../../domains/task/features/external-dispatch/codex/http/codex-session-routes.js';
import { createHttpSecurityBoundary } from './http-security-boundary.js';
import type { CodexProbePort } from '../../domains/task/features/external-dispatch/codex/codex-probe.js';
import type { CodexSessionBridgePort } from '../../domains/task/features/external-dispatch/codex/codex-session-bridge.js';

export interface HttpServerPort {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface CreateTaskWebhookAppOptions {
  bearerToken: string;
  taskTracker: TaskTrackerPort;
  uiPreferencesStore?: UiPreferencesStorePort;
  modelSettingsStore?: ModelSettingsStorePort;
  modelSecretsStore?: ModelSecretsStorePort;
  modelRegistry?: LinnsyModelRegistryPort;
  memoryStore?: MemoryProviderPort;
  agentRegistry?: LinnsyAgentRegistryPort;
  afterMemoryMutation?: () => void;
  readModel?: DashboardReadModelPort;
  conversationCreator?: ConversationCreatePort;
  conversationManagement?: ConversationManagementPort;
  desktopBus?: DesktopMessageBusPort;
  codexProbe?: CodexProbePort;
  codexSessionBridge?: CodexSessionBridgePort;
  events?: RuntimeEventHubPort;
  terminalBinding?: TerminalBindingServicePort;
  cronStore?: Pick<CronJobStorePort, 'upsert' | 'get' | 'list' | 'setEnabled' | 'remove' | 'listRuns'>;
  messageStore?: Pick<MessageStorePort, 'listByRunId'>;
  clock?: ClockPort;
}

export interface CreateHonoHttpServerOptions extends CreateTaskWebhookAppOptions {
  bind: string;
  serve?: ServeFunction;
}

export type ServeFunction = (
  options: {
    fetch: (request: Request) => Promise<Response> | Response;
    hostname: string;
    port: number;
    websocket?: { server: WebSocketServer };
  }
) => CloseableServer;

export interface CloseableServer {
  close(callback?: () => void): void;
}

// Phase 1 仅放行 loopback 起源（dev 的 Vite 任意端口 + prod Electron file:// 的
// `Origin: null`）。非 loopback 一律不回 Access-Control-Allow-Origin，浏览器侧拒绝；
// 配合 bearer token 仍是真正的访问控制，CORS 只是浏览器层不踩坑。详见
// docs/02-gateway-daemon.md §4.10f。
const loopbackOriginPattern = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/;

export function resolveLoopbackOrigin(origin: string): string | null {
  if (origin === 'null') {
    return 'null';
  }
  if (loopbackOriginPattern.test(origin)) {
    return origin;
  }
  return null;
}

export function createTaskWebhookApp(options: CreateTaskWebhookAppOptions): Hono {
  const app = new Hono();
  const clock = options.clock ?? systemClock;

  app.use('/api/*', cors({
    origin: resolveLoopbackOrigin,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600
  }));

  app.use('/api/v1/*', createHttpSecurityBoundary({ bearerToken: options.bearerToken }));

  app.post(
    '/api/v1/tasks/:taskId/update',
    zValidator('json', externalUpdateSchema),
    async (context) => {
      const taskId = context.req.param('taskId');
      const update = context.req.valid('json');
      const action = await options.taskTracker.onExternalUpdate(taskId, toExternalUpdate(update));
      return context.json({ ok: true, action });
    }
  );

  if (options.uiPreferencesStore !== undefined) {
    app.route('/', createUiPreferencesRoutes({ store: options.uiPreferencesStore }));
  }
  if (
    options.modelSettingsStore !== undefined
    && options.modelSecretsStore !== undefined
    && options.modelRegistry !== undefined
  ) {
    app.route('/', createModelSettingsRoutes({
      settingsStore: options.modelSettingsStore,
      secretsStore: options.modelSecretsStore,
      registry: options.modelRegistry
    }));
  }
  if (options.memoryStore !== undefined) {
    const memoryStore = options.memoryStore;
    const agentRegistry = options.agentRegistry;
    app.route('/', createMemoryRoutes({
      store: memoryStore,
      ...(agentRegistry === undefined
        ? {}
        : {
            systemPromptPreview: () => buildSystemPromptPreview({
              definition: agentRegistry.getDefaultAgent(),
              memoryStore
            })
          }),
      ...(options.afterMemoryMutation === undefined ? {} : { afterMutation: options.afterMemoryMutation })
    }));
  }
  if (options.desktopBus !== undefined) {
    app.route('/', createDesktopRoutes({
      bus: options.desktopBus
    }));
  }
  if (options.codexProbe !== undefined) {
    app.route('/', createApplicationConnectionsRoutes({
      codexProbe: options.codexProbe
    }));
  }
  if (options.codexSessionBridge !== undefined) {
    app.route('/', createCodexSessionRoutes({
      taskTracker: options.taskTracker,
      codexSessionBridge: options.codexSessionBridge
    }));
  }
  if (options.terminalBinding !== undefined) {
    app.route('/', createTerminalBindingRoutes({
      terminalBinding: options.terminalBinding
    }));
  }
  if (options.cronStore !== undefined) {
    app.route('/', createCronRoutes({
      cronStore: options.cronStore,
      clock,
      ...(options.messageStore === undefined ? {} : { messageStore: options.messageStore })
    }));
  }
  if (options.conversationManagement !== undefined) {
    app.route('/', createConversationRoutes({
      conversationManagement: options.conversationManagement
    }));
  }
  if (options.events !== undefined) {
    app.route('/', createStreamRoutes({
      bearerToken: options.bearerToken,
      events: options.events,
      isAllowedOrigin: (origin) => resolveLoopbackOrigin(origin) !== null
    }));
  }
  if (options.readModel !== undefined) {
    app.route('/', createObservabilityWebApp({
      readModel: options.readModel,
      ...(options.conversationCreator === undefined ? {} : { conversationCreator: options.conversationCreator })
    }));
  }

  return app;
}

export function createHonoHttpServer(options: CreateHonoHttpServerOptions): HttpServerPort {
  const app = createTaskWebhookApp(options);
  const parsed = parseBind(options.bind);
  const serveFn = options.serve ?? defaultServe;
  const websocketServer = options.events === undefined ? null : new WebSocketServer({ noServer: true });
  let server: CloseableServer | null = null;

  return {
    start(): Promise<void> {
      if (server !== null) {
        return Promise.resolve();
      }
      const serveOptions = {
        fetch: app.fetch,
        hostname: parsed.hostname,
        port: parsed.port
      };
      server = websocketServer === null
        ? serveFn(serveOptions)
        : serveFn({
          ...serveOptions,
          websocket: { server: websocketServer }
        });
      return Promise.resolve();
    },

    stop(): Promise<void> {
      if (server === null) {
        return Promise.resolve();
      }
      const active = server;
      server = null;
      return new Promise((resolve) => {
        active.close(() => {
          websocketServer?.close(() => {
            resolve();
          });
          if (websocketServer === null) {
            resolve();
          }
        });
      });
    }
  };
}

function defaultServe(
  options: {
    fetch: (request: Request) => Promise<Response> | Response;
    hostname: string;
    port: number;
    websocket?: { server: WebSocketServer };
  }
): ServerType {
  return serve(options);
}

function parseBind(bind: string): { hostname: string; port: number } {
  const separatorIndex = bind.lastIndexOf(':');
  if (separatorIndex === -1) {
    throw new Error(`invalid http bind ${bind}`);
  }
  const hostname = bind.slice(0, separatorIndex);
  const portText = bind.slice(separatorIndex + 1);
  const port = Number(portText);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid http bind port ${portText}`);
  }
  return { hostname, port };
}
