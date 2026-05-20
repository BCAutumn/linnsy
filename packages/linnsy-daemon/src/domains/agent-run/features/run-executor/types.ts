import type { GraphExecutor } from '@linnlabs/linnkit/runtime-kernel';
import type { AgentAiEngine } from '@linnlabs/linnkit/ports';
import type { AuditPort } from '@linnlabs/linnkit/ports';
import type { AiMessage } from '@linnlabs/linnkit/contracts';

import type { SqliteCheckpointer } from '../../../../persistence/stores/run/sqlite-checkpointer.js';
import type { SqliteMemoryStore } from '../../../memory/persistence/sqlite-memory-store.js';
import type { MessageStorePort } from '../../../../persistence/stores/message/message-store-port.js';
import type { ClockPort, LoggerPort } from '../../../../shared/ports.js';
import type {
  RuntimeEvent,
  RuntimeEventPublishInput
} from '../../../observability/definitions/runtime-events.js';
import type { LinnsyModelRegistryPort } from '../../../llm/features/model-registry/model-registry.js';

export interface RunExecutorEventPort {
  publish(input: RuntimeEventPublishInput): RuntimeEvent;
}

export interface RunContextAuditPort {
  recordRunContext(input: RunContextAuditInput): Promise<void>;
}

export interface RunContextAuditInput {
  runId: string;
  conversationId: string;
  turnId: string;
  query: string;
  status: 'completed' | 'failed' | 'cancelled';
  currentNode?: string;
  iterationsUsed?: number;
  finalAnswer?: string;
  error?: { code: string; message: string; recoverable: boolean };
  wakeSource?: string;
  contextFenceCount: number;
  startedAt: number;
  completedAt: number;
  snapshots: RunContextSnapshotInput[];
}

export interface RunContextSnapshotInput {
  sequence: number;
  modelId: string;
  messageCount: number;
  messages: AiMessage[];
}

export interface RunExecutorFoundationDeps {
  modelRegistry: LinnsyModelRegistryPort;
  aiEngine: AgentAiEngine;
  auditPort: AuditPort;
  runContextAudit: RunContextAuditPort;
  clock: ClockPort;
  logger: LoggerPort;
  messages: MessageStorePort;
  checkpointer: SqliteCheckpointer;
  memoryStore: SqliteMemoryStore;
  graphExecutor: GraphExecutor;
}
