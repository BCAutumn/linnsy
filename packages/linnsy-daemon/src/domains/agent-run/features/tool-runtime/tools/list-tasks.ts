import type { OpenAIToolSchema, ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../shared/errors.js';
import type { TaskKind, TaskListFilter, TaskRecord, TaskStatus } from '../../../../task/definitions/task.js';
import type { TaskTrackerPort } from '../../../../task/ports/task-tracker-port.js';
import { toJsonObjectSchema, type LinnsyTool, type StructuredToolResult } from '../types.js';
import { formatTaskSummaryLine } from './task-observation.js';

export interface ListTasksOutput extends Record<string, unknown> {
  tasks: TaskRecord[];
  appliedFilter: TaskListFilter;
}

export interface CreateListTasksToolOptions {
  taskTracker: TaskTrackerPort;
}

export interface ListTasksTool extends Omit<LinnsyTool, 'execute'> {
  execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<StructuredToolResult<ListTasksOutput>>;
}

const defaultStatuses: TaskStatus[] = ['dispatched', 'in_progress', 'paused', 'completed', 'failed', 'cancelled'];
const allStatuses: TaskStatus[] = [
  'received',
  'dispatched',
  'in_progress',
  'paused',
  'completed',
  'reported',
  'archived',
  'failed',
  'cancelled'
];
const allKinds: TaskKind[] = ['external', 'internal_subagent'];

export function createListTasksTool(options: CreateListTasksToolOptions): ListTasksTool {
  return {
    name: 'list_tasks',
    description: 'List delegated tasks ordered by latest update time, defaulting to active tasks plus finished tasks within the result limit.',
    definition: {
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          includeAllConversations: {
            type: 'boolean',
            description: 'Set true only when the owner explicitly asks for tasks across all conversations. Defaults to the current conversation.'
          },
          status: {
            type: 'array',
            items: {
              type: 'string',
              enum: allStatuses,
              description: 'Task status.'
            },
            description: 'Optional statuses to include. Defaults to dispatched, in_progress, paused, completed, failed, and cancelled; results are still ordered by latest update time and capped by limit.'
          },
          conversationId: {
            type: 'string',
            description: 'Optional conversation id filter.'
          },
          kind: {
            type: 'string',
            enum: allKinds,
            description: 'Optional task kind filter.'
          },
          limit: {
            type: 'number',
            description: 'Maximum number of tasks to return, clamped to 100.'
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
    async execute(args, context): Promise<StructuredToolResult<ListTasksOutput>> {
      const filter = readFilter(args, context.conversationId);
      const tasks = await options.taskTracker.list(filter);
      return {
        data: { tasks, appliedFilter: filter },
        observation: buildListTasksObservation(tasks, filter)
      };
    }
  };
}

function buildListTasksObservation(tasks: TaskRecord[], filter: TaskListFilter): string {
  const scope = filter.conversationId === undefined ? 'all_conversations' : `conversationId=${filter.conversationId}`;
  const lines = [
    `已列出 ${String(tasks.length)} 个任务，scope=${scope}，status=${(filter.status ?? []).join(',')}，limit=${String(filter.limit)}。`
  ];
  if (tasks.length > 0) {
    lines.push('任务列表：');
    lines.push(...tasks.map((task) => `- ${formatTaskSummaryLine(task)}`));
  }
  return lines.join('\n');
}

function readFilter(args: Record<string, unknown>, contextConversationId: string | undefined): TaskListFilter {
  const includeAllConversations = readIncludeAllConversations(args.includeAllConversations);
  if (includeAllConversations && args.conversationId !== undefined) {
    throw invalidArgument('list_tasks includeAllConversations cannot be combined with conversationId');
  }
  const filter: TaskListFilter = {
    status: readStatuses(args.status),
    limit: readLimit(args.limit)
  };
  if (args.conversationId !== undefined) {
    filter.conversationId = readNonEmptyString(args.conversationId, 'conversationId');
  } else if (!includeAllConversations && contextConversationId !== undefined) {
    filter.conversationId = contextConversationId;
  }
  if (args.kind !== undefined) {
    filter.kind = readKind(args.kind);
  }
  return filter;
}

function readIncludeAllConversations(value: unknown): boolean {
  if (value === undefined) {
    return false;
  }
  if (typeof value !== 'boolean') {
    throw invalidArgument('list_tasks includeAllConversations must be a boolean');
  }
  return value;
}

function readStatuses(value: unknown): TaskStatus[] {
  if (value === undefined) {
    return [...defaultStatuses];
  }
  if (!Array.isArray(value)) {
    throw invalidArgument('list_tasks status must be an array');
  }
  return value.map((entry) => {
    if (!isTaskStatus(entry)) {
      throw invalidArgument(`list_tasks status contains invalid value ${String(entry)}`);
    }
    return entry;
  });
}

function readLimit(value: unknown): number {
  if (value === undefined) {
    return 100;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw invalidArgument('list_tasks limit must be a positive integer');
  }
  return Math.min(value, 100);
}

function readKind(value: unknown): TaskKind {
  if (!isTaskKind(value)) {
    throw invalidArgument(`list_tasks kind contains invalid value ${String(value)}`);
  }
  return value;
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidArgument(`list_tasks ${label} must be a non-empty string`);
  }
  return value;
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && allStatuses.includes(value as TaskStatus);
}

function isTaskKind(value: unknown): value is TaskKind {
  return typeof value === 'string' && allKinds.includes(value as TaskKind);
}

function invalidArgument(message: string): LinnsyError {
  return new LinnsyError(LINNSY_ERROR_CODES.RUN_EXECUTOR_FAILED, message, false);
}
