import { LINNSY_ERROR_CODES } from '../../../../shared/errors.js';
import type { UiPreferencesStorePort } from '../../../../domains/desktop-integration/persistence/ui-preferences/ui-preferences-store-port.js';
import type { MemoryProviderPort } from '../../../../domains/memory/persistence/memory-store-port.js';
import type { CronJobStorePort } from '../../../../domains/cron/persistence/cron-job-store-port.js';
import type { CronJobRecord } from '../../../../domains/cron/definitions/cron.js';
import { createRuntimeEventHub } from '../../../../domains/observability/features/event-hub/event-hub.js';
import type { TerminalBindingServicePort } from '../../../../domains/desktop-integration/features/terminal-binding/terminal-binding-service.js';
import type { TaskTrackerPort } from '../../../../domains/task/ports/task-tracker-port.js';
import {
  createHonoHttpServer,
  createTaskWebhookApp,
  type ServeFunction
} from '../../hono-server.js';


export function taskTracker(overrides: Partial<TaskTrackerPort>): TaskTrackerPort {
  return {
    upsert: () => Promise.reject(new Error('not used')),
    transition: () => Promise.reject(new Error('not used')),
    delete: () => Promise.reject(new Error('not used')),
    get: () => Promise.resolve(null),
    list: () => Promise.resolve([]),
    onExternalUpdate: () => Promise.resolve('silent'),
    ...overrides
  };
}

export function uiPreferencesStore(): UiPreferencesStorePort {
  return {
    get: () => Promise.resolve(null),
    getAll: () => Promise.resolve({
      'theme.mode': 'auto'
    }),
    set: () => Promise.resolve(),
    reset: () => Promise.resolve(),
    register: () => undefined
  };
}

export function memoryStore(): MemoryProviderPort {
  return {
    list: () => Promise.resolve([]),
    recall: () => Promise.resolve([]),
    upsert: (input) => Promise.resolve({
      memoryId: input.memoryId ?? 'mem_1',
      scope: input.scope,
      body: input.body,
      createdAt: 1,
      updatedAt: 1
    }),
    remove: () => Promise.resolve(false)
  };
}

export function terminalBinding(overrides: Partial<TerminalBindingServicePort>): TerminalBindingServicePort {
  return {
    ensureDefaultBinding: () => Promise.resolve({
      terminalId: 'mobile',
      conversationId: 'conv_1',
      updatedAt: 1,
      updatedBy: 'system-default'
    }),
    getBinding: () => Promise.resolve({
      terminalId: 'mobile',
      conversationId: 'conv_1',
      updatedAt: 1,
      updatedBy: 'system-default'
    }),
    bindToConversation: (conversationId, updatedBy) => Promise.resolve({
      terminalId: 'mobile',
      conversationId,
      updatedAt: 2,
      updatedBy
    }),
    resolveInboundSession: () => Promise.resolve(null),
    ...overrides
  };
}

export function sampleCronJob(jobId: string): CronJobRecord {
  return {
    jobId,
    enabled: true,
    schedule: { kind: 'one_shot', atMs: 1_000 },
    nextRunAt: 1_000,
    missGraceMs: 7_200_000,
    payload: {
      definitionKey: 'linnsy_cron_runner',
      query: 'sample query'
    },
    createdAt: 0,
    updatedAt: 0
  };
}

export function cronStore(
  overrides: Partial<Pick<CronJobStorePort, 'upsert' | 'get' | 'list' | 'setEnabled' | 'remove' | 'listRuns'>>
): Pick<CronJobStorePort, 'upsert' | 'get' | 'list' | 'setEnabled' | 'remove' | 'listRuns'> {
  return {
    upsert: (record) => Promise.resolve(record),
    get: () => Promise.resolve(null),
    list: () => Promise.resolve([]),
    setEnabled: () => Promise.resolve(false),
    remove: () => Promise.resolve(false),
    listRuns: () => Promise.resolve([]),
    ...overrides
  };
}

export function withOptionalNode(
  value: { taskId: string; node?: string },
  node: string | undefined
): { taskId: string; node?: string } {
  if (node !== undefined) {
    value.node = node;
  }
  return value;
}

export { LINNSY_ERROR_CODES, createRuntimeEventHub, createHonoHttpServer, createTaskWebhookApp };
export type { CronJobStorePort, TerminalBindingServicePort, ServeFunction };
