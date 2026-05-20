import type { GraphExecutor } from '@linnlabs/linnkit/runtime-kernel';
import type { AgentAiEngine } from '@linnlabs/linnkit/ports';
import type { AuditPort } from '@linnlabs/linnkit/ports';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import { join } from 'node:path';

import type { LinnsyConfig } from '../../config/schema.js';
import { openLinnsyDatabase } from '../../persistence/db.js';
import { SqliteConversationStore } from '../../persistence/stores/conversation/sqlite-conversation-store.js';
import type { ConversationStorePort } from '../../persistence/stores/conversation/conversation-store-port.js';
import { SqliteCheckpointer } from '../../persistence/stores/run/sqlite-checkpointer.js';
import { SqliteMessageStore } from '../../persistence/stores/message/sqlite-message-store.js';
import type { MessageStorePort } from '../../persistence/stores/message/message-store-port.js';
import { SqlitePairingStore } from '../../persistence/stores/pairing/sqlite-pairing-store.js';
import type { PairingStorePort } from '../../persistence/stores/pairing/pairing-store-port.js';
import { SqliteTerminalBindingStore } from '../../domains/desktop-integration/persistence/terminal-binding/sqlite-terminal-binding-store.js';
import type { TerminalBindingStorePort } from '../../domains/desktop-integration/persistence/terminal-binding/terminal-binding-store-port.js';
import { SqliteCronJobStore } from '../../domains/cron/persistence/sqlite-cron-job-store.js';
import type { CronJobStorePort } from '../../domains/cron/persistence/cron-job-store-port.js';
import { SqliteEventStore } from '../../persistence/stores/event/sqlite-event-store.js';
import type { EventStorePort } from '../../persistence/stores/event/event-store-port.js';
import { SqliteRunRegistryStore } from '../../persistence/stores/run/sqlite-run-registry-store.js';
import { SqliteTaskStore } from '../../domains/task/persistence/sqlite-task-store.js';
import { createDefaultUiPreferencesStore, type SqliteUiPreferencesStore } from '../../domains/desktop-integration/persistence/ui-preferences/sqlite-ui-preferences-store.js';
import { SqliteModelSettingsStore } from '../../domains/llm/persistence/model-settings/sqlite-model-settings-store.js';
import { SqliteModelSecretsStore } from '../../domains/llm/persistence/model-secrets/sqlite-model-secrets-store.js';
import { toRuntimeModelSettings } from '../../domains/llm/persistence/model-settings/model-settings-store-port.js';
import { SqliteMemoryStore } from '../../domains/memory/persistence/sqlite-memory-store.js';
import type { ClockPort, LoggerPort } from '../../shared/ports.js';
import { consoleLogger, systemClock } from '../../shared/ports.js';
import { createLinnsyAiEngineBridge } from '../llm/ai-engine.js';
import { getDefaultLinnsyFenceRegistry } from '../../domains/agent-run/features/context-engineering/fences.js';
import {
  createFileLlmRequestDebugObserver,
  noopLlmRequestDebugObserver,
  type LlmRequestDebugObserverPort
} from '../../domains/llm/shared/llm-request-debug-observer.js';
import { createModelRegistry, type LinnsyModelRegistryPort } from '../../domains/llm/features/model-registry/model-registry.js';
import {
  createProviderRouter,
  type LinnsyProviderRouter
} from '../../domains/llm/features/provider-routing/provider-router.js';
import { createLinnsyGraphExecutor } from '../../domains/agent-run/features/run-executor/linnkit-graph-executor.js';
import { createTaskTracker } from '../../domains/task/features/tracker/task-tracker.js';
import type { TaskTrackerPort, TaskWakeHook } from '../../domains/task/ports/task-tracker-port.js';
import {
  createLinnsyAuditManager,
  type LinnsyAuditManager,
  type RunContextAuditPort
} from '../../domains/observability/features/audit/linnsy-audit.js';

export interface LinnsyRuntimeFoundation {
  db: SqliteDatabase;
  modelRegistry: LinnsyModelRegistryPort;
  providerRouter: LinnsyProviderRouter;
  llmRequestDebugObserver: LlmRequestDebugObserverPort;
  auditPort: AuditPort;
  auditManager: LinnsyAuditManager;
  auditLogPath: string;
  runContextAudit: RunContextAuditPort;
  runContextAuditLogPath: string;
  aiEngine: AgentAiEngine;
  clock: ClockPort;
  logger: LoggerPort;
  conversations: ConversationStorePort;
  messages: MessageStorePort;
  pairings: PairingStorePort;
  terminalBindings: TerminalBindingStorePort;
  checkpointer: SqliteCheckpointer;
  runRegistry: SqliteRunRegistryStore;
  cronStore: CronJobStorePort;
  eventStore: EventStorePort;
  taskStore: SqliteTaskStore;
  uiPreferencesStore: SqliteUiPreferencesStore;
  modelSettingsStore: SqliteModelSettingsStore;
  modelSecretsStore: SqliteModelSecretsStore;
  memoryStore: SqliteMemoryStore;
  taskTracker: TaskTrackerPort;
  graphExecutor: GraphExecutor;
  // daemon 创建 RunSpawner 后把任务终态唤醒 hook 挂回 TaskTracker。
  attachTaskWakeHook(hook: TaskWakeHook): void;
  dispose(): void;
}

export interface CreateLinnsyRuntimeFoundationOptions {
  db?: SqliteDatabase;
  dbPath?: string;
  env?: Record<string, string | undefined>;
  providerRouter?: LinnsyProviderRouter;
  maxSteps?: number;
  clock?: ClockPort;
  logger?: LoggerPort;
}

export function createLinnsyRuntimeFoundation(
  config: LinnsyConfig,
  options: CreateLinnsyRuntimeFoundationOptions = {}
): LinnsyRuntimeFoundation {
  const ownsDatabase = options.db === undefined;
  const db = options.db ?? openLinnsyDatabase(options.dbPath ?? join(config.home, 'state.db'));
  const clock = options.clock ?? systemClock;
  const logger = options.logger ?? consoleLogger;
  const logLifecycle = options.logger !== undefined;
  const uiPreferencesStore = createDefaultUiPreferencesStore(db, { now: () => clock.now() });
  const modelSettingsStore = new SqliteModelSettingsStore(db, { now: () => clock.now() });
  const modelSecretsStore = new SqliteModelSecretsStore(db, { home: config.home, now: () => clock.now() });
  modelSettingsStore.migrateLegacyUiPreferences(modelSecretsStore);
  const modelRegistry = createModelRegistry(config, readRuntimeModelSettings(modelSettingsStore, modelSecretsStore));
  const llmRequestDebugObserver = createLlmRequestDebugObserver(config, logger);
  const auditManager = createLinnsyAuditManager({ config, logger });
  const auditPort = auditManager.decisionAuditPort;
  const auditLogPath = auditManager.decisionLogPath;
  const runContextAudit = auditManager.runContextAudit;
  const runContextAuditLogPath = auditManager.runContextLogPath;
  const providerRouter = options.providerRouter ?? createProviderRouterOptions(options.env, llmRequestDebugObserver);
  const aiEngine = createLinnsyAiEngineBridge({
    registry: modelRegistry,
    router: providerRouter,
    llmRequestDebugObserver,
    logger
  });
  const conversations = new SqliteConversationStore(db);
  const messages = new SqliteMessageStore(db);
  const pairings = new SqlitePairingStore(db);
  const terminalBindings = new SqliteTerminalBindingStore(db);
  const checkpointer = new SqliteCheckpointer(db, clock);
  const runRegistry = new SqliteRunRegistryStore(db);
  const cronStore = new SqliteCronJobStore(db);
  const eventStore = new SqliteEventStore(db, { conversations });
  const taskStore = new SqliteTaskStore(db);
  const memoryStore = new SqliteMemoryStore(db, { now: () => clock.now() });
  let taskWakeHook: TaskWakeHook | undefined;
  const taskTracker = createTaskTracker({
    tasks: taskStore,
    clock,
    wakeMainOnTransition: () => taskWakeHook,
    logger
  });
  const graphExecutor = createLinnsyGraphExecutor({
    checkpointer,
    aiEngine,
    modelRegistry,
    auditPort,
    ...(options.maxSteps === undefined ? {} : { maxSteps: options.maxSteps })
  });

  return {
    db,
    modelRegistry,
    providerRouter,
    llmRequestDebugObserver,
    auditManager,
    auditPort,
    auditLogPath,
    runContextAudit,
    runContextAuditLogPath,
    aiEngine,
    clock,
    logger,
    conversations,
    messages,
    pairings,
    terminalBindings,
    checkpointer,
    runRegistry,
    cronStore,
    eventStore,
    taskStore,
    uiPreferencesStore,
    modelSettingsStore,
    modelSecretsStore,
    memoryStore,
    taskTracker,
    graphExecutor,
    attachTaskWakeHook(hook: TaskWakeHook): void {
      taskWakeHook = hook;
    },
    dispose(): void {
      auditManager.dispose();
      providerRouter.dispose?.();
      if (ownsDatabase && db.open) {
        db.close();
      }
      if (logLifecycle) {
        logger.info('Linnsy runtime foundation disposed');
      }
    }
  };
}

function createProviderRouterOptions(
  env: Record<string, string | undefined> | undefined,
  llmRequestDebugObserver: LlmRequestDebugObserverPort
): LinnsyProviderRouter {
  if (env === undefined) {
    return createProviderRouter({
      llmRequestDebugObserver,
      fenceRegistry: getDefaultLinnsyFenceRegistry()
    });
  }

  return createProviderRouter({
    env,
    llmRequestDebugObserver,
    fenceRegistry: getDefaultLinnsyFenceRegistry()
  });
}

function readRuntimeModelSettings(
  modelSettingsStore: SqliteModelSettingsStore,
  modelSecretsStore: SqliteModelSecretsStore
) {
  const settings = modelSettingsStore.getSync();
  return toRuntimeModelSettings(
    settings,
    modelSecretsStore.listApiKeysSync(settings.userModels.map((model) => model.id))
  );
}

function createLlmRequestDebugObserver(config: LinnsyConfig, logger: LoggerPort): LlmRequestDebugObserverPort {
  const debug = config.observability?.llm_request_debug;
  if (debug?.enabled !== true) {
    return noopLlmRequestDebugObserver;
  }
  return createFileLlmRequestDebugObserver({
    enabled: true,
    home: config.home,
    ...(debug.dir === undefined ? {} : { dir: debug.dir }),
    logger,
    ...(debug.max_message_chars === undefined ? {} : { maxMessageChars: debug.max_message_chars }),
    ...(debug.max_records_per_run === undefined ? {} : { maxRecordsPerRun: debug.max_records_per_run }),
    ...(debug.max_file_bytes === undefined ? {} : { maxFileBytes: debug.max_file_bytes }),
    ...(debug.max_files === undefined ? {} : { maxFiles: debug.max_files })
  });
}
