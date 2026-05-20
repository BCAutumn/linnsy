import type { OpenAIToolSchema, ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../shared/errors.js';
import type { TaskRecord } from '../../../../task/definitions/task.js';
import type { TaskTrackerPort } from '../../../../task/ports/task-tracker-port.js';
import { toJsonObjectSchema, type LinnsyTool, type StructuredToolResult } from '../types.js';
import { resolveTaskByInput } from './task-id-resolver.js';
import { formatTaskSummaryLine, readStringField } from './task-observation.js';

export interface GetTaskStatusOutput extends Record<string, unknown> {
  task: TaskRecord;
  attemptHistory: TaskRecord[];
}

export interface CreateGetTaskStatusToolOptions {
  taskTracker: TaskTrackerPort;
}

export interface GetTaskStatusTool extends Omit<LinnsyTool, 'execute'> {
  execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<StructuredToolResult<GetTaskStatusOutput>>;
}

export function createGetTaskStatusTool(options: CreateGetTaskStatusToolOptions): GetTaskStatusTool {
  return {
    name: 'get_task_status',
    description: 'Get one delegated task status, related attempt history, and an actionable diagnosis summary with locator, node, session, and failure details.',
    definition: {
      parameters: {
        type: 'object',
        required: ['taskId'],
        additionalProperties: false,
        properties: {
          taskId: {
            type: 'string',
            description: 'Task id to inspect.'
          }
        }
      }
    },
    getSchema(): OpenAIToolSchema {
      return {
        type: 'function',
        function: {
          name: this.name,
          description: this.description,
          parameters: toJsonObjectSchema(this.definition.parameters)
        }
      };
    },
    async execute(args, context): Promise<StructuredToolResult<GetTaskStatusOutput>> {
      const taskId = readTaskId(args.taskId);
      const { task: resolvedTask } = await resolveTaskByInput(taskId, context.conversationId, options.taskTracker);
      const attemptHistory = await collectAttemptHistory(resolvedTask, options.taskTracker);
      return {
        data: { task: resolvedTask, attemptHistory },
        observation: buildTaskStatusObservation(taskId, resolvedTask, attemptHistory)
      };
    }
  };
}

function buildTaskStatusObservation(inputTaskId: string, task: TaskRecord, attemptHistory: TaskRecord[]): string {
  const attemptLines = attemptHistory.map(formatAttemptDiagnosisLine);
  const resolvedLine =
    inputTaskId === task.taskId ? '' : `输入 taskId=${inputTaskId}，已按前缀匹配到 ${task.taskId}。`;
  const finalReplyLines = buildFinalReplyLines(task);
  return [
    `任务 ${task.taskId} 当前 status=${task.status}，attemptHistory=${String(attemptHistory.length)}。`,
    resolvedLine,
    '任务诊断摘要：',
    ...attemptLines,
    ...finalReplyLines
  ].filter((line) => line.length > 0).join('\n');
}

function formatAttemptDiagnosisLine(task: TaskRecord): string {
  return `- attempt=${String(task.attemptCount)}；${formatTaskSummaryLine(task)}`;
}

function buildFinalReplyLines(task: TaskRecord): string[] {
  const finalMessage = readStringField(task.result, 'finalMessage');
  if (finalMessage === undefined) {
    return [];
  }
  return [
    '',
    '完成回复：',
    truncateFinalReplyForObservation(finalMessage)
  ];
}

function truncateFinalReplyForObservation(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  // 工具 observation 是给主模型继续对话用的；保留足够正文，同时避免超大回复挤爆上下文。
  return normalized.length > 4_000 ? `${normalized.slice(0, 4_000)}...（已截断）` : normalized;
}

async function collectAttemptHistory(task: TaskRecord, taskTracker: TaskTrackerPort): Promise<TaskRecord[]> {
  const ancestors = new Map<string, TaskRecord>();
  ancestors.set(task.taskId, task);
  let current = task;
  while (current.parentTaskId !== undefined) {
    const parent = await taskTracker.get(current.parentTaskId);
    if (parent === null || ancestors.has(parent.taskId)) {
      break;
    }
    ancestors.set(parent.taskId, parent);
    current = parent;
  }

  const root = current;
  const history: TaskRecord[] = [];
  const visited = new Set<string>();
  await appendWithDescendants(root, taskTracker, history, visited);
  return history;
}

async function appendWithDescendants(
  task: TaskRecord,
  taskTracker: TaskTrackerPort,
  history: TaskRecord[],
  visited: Set<string>
): Promise<void> {
  if (visited.has(task.taskId)) {
    return;
  }
  visited.add(task.taskId);
  history.push(task);

  const children = await taskTracker.list({ parentTaskId: task.taskId, limit: 100 });
  children.sort(compareAttemptOrder);
  for (const child of children) {
    await appendWithDescendants(child, taskTracker, history, visited);
  }
}

function compareAttemptOrder(left: TaskRecord, right: TaskRecord): number {
  if (left.attemptCount !== right.attemptCount) {
    return left.attemptCount - right.attemptCount;
  }
  if (left.createdAt !== right.createdAt) {
    return left.createdAt - right.createdAt;
  }
  return left.taskId.localeCompare(right.taskId);
}

function readTaskId(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new LinnsyError(
      LINNSY_ERROR_CODES.RUN_EXECUTOR_FAILED,
      'get_task_status taskId must be a non-empty string',
      false
    );
  }
  return value.trim();
}
