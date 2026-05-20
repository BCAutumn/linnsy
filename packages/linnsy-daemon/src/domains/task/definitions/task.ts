import { z } from 'zod';

export type TaskStatus =
  | 'received'
  | 'dispatched'
  | 'in_progress'
  | 'paused'
  | 'completed'
  | 'reported'
  | 'archived'
  | 'failed'
  | 'cancelled';

export type TaskKind = 'external' | 'internal_subagent';
export type ExternalAgentKind = 'linnya' | 'cursor' | 'codex' | 'claude_code' | 'chatgpt_web' | 'mcp' | 'manual';
export type TaskLocatorKind = 'directory' | 'project' | 'remote' | 'none';

export interface TaskLocator {
  kind: TaskLocatorKind;
  label: string;
  ref?: string;
  meta?: Record<string, unknown>;
}

export interface TaskRecord {
  taskId: string;
  conversationId: string;
  originRunId?: string;
  parentTaskId?: string;
  kind: TaskKind;
  attemptCount: number;
  externalRef?: string;
  externalKind?: ExternalAgentKind;
  locator?: TaskLocator;
  title: string;
  status: TaskStatus;
  dueAt?: number;
  lastNode?: string;
  reportedAt?: number;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  workspacePath?: string;
  createdAt: number;
  updatedAt: number;
  pausedAt?: number;
  completedAt?: number;
  cancelledAt?: number;
  cancelReason?: string;
}

export type TaskUpsertInput = Omit<TaskRecord, 'createdAt' | 'updatedAt' | 'attemptCount' | 'kind'> & {
  createdAt?: number;
  updatedAt?: number;
  attemptCount?: number;
  kind?: TaskKind;
};

export type TaskTransitionPatch = Partial<Omit<TaskRecord, 'completedAt'>> & {
  completedAt?: number | null;
};

export interface TaskListFilter {
  status?: TaskStatus[];
  conversationId?: string;
  kind?: TaskKind;
  parentTaskId?: string;
  limit?: number;
  sinceUpdatedAt?: number;
}

export interface ExternalUpdate {
  node?: string;
  status?: TaskStatus;
  /** 外部 agent 的进度片段：按对象补丁语义深度合并进 TaskRecord.result。 */
  partialResult?: Record<string, unknown>;
  /** 外部 agent 的终态结果：完成任务时完整替换 TaskRecord.result。 */
  finalResult?: Record<string, unknown>;
  errorMessage?: string;
  meta?: Record<string, unknown>;
}

export const taskStatusSchema = z.enum([
  'received',
  'dispatched',
  'in_progress',
  'paused',
  'completed',
  'reported',
  'archived',
  'failed',
  'cancelled'
]);

const jsonObjectSchema = z.record(z.unknown());

export const externalUpdateSchema = z.object({
  node: z.string().min(1).optional(),
  status: taskStatusSchema.optional(),
  partialResult: jsonObjectSchema.optional(),
  finalResult: jsonObjectSchema.optional(),
  errorMessage: z.string().min(1).optional(),
  meta: jsonObjectSchema.optional()
}).strict();

export function parseExternalUpdate(value: unknown): ExternalUpdate {
  return toExternalUpdate(externalUpdateSchema.parse(value));
}

export function toExternalUpdate(input: z.infer<typeof externalUpdateSchema>): ExternalUpdate {
  const update: ExternalUpdate = {};
  if (input.node !== undefined) update.node = input.node;
  if (input.status !== undefined) update.status = input.status;
  if (input.partialResult !== undefined) update.partialResult = input.partialResult;
  if (input.finalResult !== undefined) update.finalResult = input.finalResult;
  if (input.errorMessage !== undefined) update.errorMessage = input.errorMessage;
  if (input.meta !== undefined) update.meta = input.meta;
  return update;
}
