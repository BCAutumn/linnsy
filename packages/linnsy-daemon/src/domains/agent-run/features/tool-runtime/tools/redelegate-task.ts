import type { OpenAIToolSchema, ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';
import { randomUUID } from 'node:crypto';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../shared/errors.js';
import { isRecord } from '../../../../../shared/json.js';
import type { LinnsyAgentRegistryPort } from '../../agents/registry/types.js';
import type { ExternalAgentDispatcherPort, ExternalAgentDispatchInput } from '../../../../task/features/external-dispatch/types.js';
import {
  normalizeExternalAgentDefinitionKey,
  resolveExternalAgentKind
} from '../../../../task/features/external-dispatch/vendor-kind.js';
import type { InternalSubAgentRunInput, InternalSubAgentRunner } from '../../internal-subagent/types.js';
import type { LinnsyNotificationLayer } from '../../../../conversation/features/notification/types.js';
import type { TaskKind, TaskLocator, TaskRecord, TaskUpsertInput } from '../../../../task/definitions/task.js';
import { readTaskLocator } from '../../../../task/features/lifecycle/functions/task-locator.js';
import type { TaskTrackerPort } from '../../../../task/ports/task-tracker-port.js';
import type { WorkspacePort } from '../../../../task/features/workspace/definitions/types.js';
import { toJsonObjectSchema, type LinnsyTool, type StructuredToolResult } from '../types.js';

export interface RedelegateTaskInput {
  taskId: string;
  improvedSpec?: {
    title?: string;
    locator?: TaskLocator;
    payload?: Record<string, unknown>;
    targetDefinitionKey?: string;
  };
}

export interface RedelegateTaskOutput extends Record<string, unknown> {
  oldTaskId: string;
  newTaskId: string;
  workspacePath: string;
  status: 'dispatched';
}

export interface CreateRedelegateTaskToolOptions {
  registry: LinnsyAgentRegistryPort;
  taskTracker: TaskTrackerPort;
  workspace: WorkspacePort;
  dispatcher: ExternalAgentDispatcherPort;
  internalRunner: InternalSubAgentRunner;
  notification?: LinnsyNotificationLayer;
  taskIdFactory?: () => string;
}

export interface RedelegateTaskTool extends Omit<LinnsyTool, 'execute'> {
  execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<StructuredToolResult<RedelegateTaskOutput>>;
}

export function createRedelegateTaskTool(options: CreateRedelegateTaskToolOptions): RedelegateTaskTool {
  const taskIdFactory = options.taskIdFactory ?? defaultTaskIdFactory;

  return {
    name: 'redelegate_task',
    description: 'Create a new attempt for a failed delegated task, with a strict retry limit.',
    definition: {
      parameters: {
        type: 'object',
        required: ['taskId'],
        additionalProperties: false,
        properties: {
          taskId: {
            type: 'string',
            description: 'Failed task id to redelegate.'
          },
          improvedSpec: {
            type: 'object',
            description: 'Optional title, locator, payload, or target definition override for the new attempt. Known external vendor aliases such as codex are canonicalized.'
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
    async execute(args, context): Promise<StructuredToolResult<RedelegateTaskOutput>> {
      const input = readInput(args);
      const oldTask = await readFailedTask(options.taskTracker, input.taskId);
      const nextAttemptCount = oldTask.attemptCount + 1;
      if (nextAttemptCount > 2) {
        await notifyRedelegateLimit(options.notification, oldTask);
        throw new LinnsyError(
          LINNSY_ERROR_CODES.TASK_REDELEGATE_LIMIT,
          `task ${oldTask.taskId} already reached redelegate attempt limit`,
          false
        );
      }

      const definitionKey = readTargetDefinitionKey(oldTask, input);
      const definition = options.registry.assertAgent(definitionKey);
      assertDefinitionKind(definition.metadata, definitionKey, oldTask.kind);

      const payload = buildPayload(oldTask, input, definitionKey);
      const locator = readRedelegateLocator(oldTask, input);
      const newTaskId = taskIdFactory();
      const workspacePath = await options.workspace.create(newTaskId);
      const externalKind = oldTask.kind === 'external'
        ? resolveExternalAgentKind(definitionKey)
        : undefined;
      await options.taskTracker.upsert(withOptionalOriginRunId({
        taskId: newTaskId,
        conversationId: oldTask.conversationId,
        parentTaskId: oldTask.taskId,
        title: input.improvedSpec?.title ?? oldTask.title,
        status: 'received',
        kind: oldTask.kind,
        ...(externalKind === undefined ? {} : { externalKind }),
        ...(locator === undefined ? {} : { locator }),
        attemptCount: nextAttemptCount,
        workspacePath,
        payload
      }, context.runId));

      if (oldTask.kind === 'external') {
        await options.taskTracker.transition(newTaskId, 'dispatched');
        try {
          await options.dispatcher.dispatch(withOptionalDispatchPayload({
            taskId: newTaskId,
            definitionKey,
            locator: readRequiredExternalLocator(locator, newTaskId),
            workspacePath
          }, payload));
        } catch (error: unknown) {
          await options.taskTracker.transition(newTaskId, 'failed', {
            result: { errorMessage: error instanceof Error ? error.message : String(error) }
          });
          throw error;
        }
      } else {
        await options.taskTracker.transition(newTaskId, 'dispatched');
        options.internalRunner.spawn(buildInternalRunInput({
          taskId: newTaskId,
          definitionKey,
          workspacePath,
          goal: readInternalGoal(input.improvedSpec?.title ?? oldTask.title, payload),
          parentConversationId: oldTask.conversationId,
          ...(context.runId === undefined ? {} : { parentRunId: context.runId })
        }, payload));
      }

      const data: RedelegateTaskOutput = {
        oldTaskId: oldTask.taskId,
        newTaskId,
        workspacePath,
        status: 'dispatched'
      };
      return {
        data,
        observation: `已将失败任务 ${oldTask.taskId} 重新派发为 ${newTaskId}，status=dispatched，workspacePath=${workspacePath}。`
      };
    }
  };
}

function readInput(args: Record<string, unknown>): RedelegateTaskInput {
  const taskId = readNonEmptyString(args.taskId, 'taskId');
  const result: RedelegateTaskInput = { taskId };
  if (args.improvedSpec !== undefined) {
    if (!isRecord(args.improvedSpec)) {
      throw invalidArgument('redelegate_task improvedSpec must be an object');
    }
    const improvedSpec: RedelegateTaskInput['improvedSpec'] = {};
    if (args.improvedSpec.title !== undefined) {
      improvedSpec.title = readNonEmptyString(args.improvedSpec.title, 'improvedSpec.title');
    }
    if (args.improvedSpec.payload !== undefined) {
      if (!isRecord(args.improvedSpec.payload)) {
        throw invalidArgument('redelegate_task improvedSpec.payload must be an object');
      }
      improvedSpec.payload = args.improvedSpec.payload;
    }
    if (args.improvedSpec.locator !== undefined) {
      improvedSpec.locator = readTaskLocator(args.improvedSpec.locator, 'redelegate_task improvedSpec.locator');
    }
    if (args.improvedSpec.targetDefinitionKey !== undefined) {
      improvedSpec.targetDefinitionKey = normalizeExternalAgentDefinitionKey(
        readNonEmptyString(args.improvedSpec.targetDefinitionKey, 'improvedSpec.targetDefinitionKey')
      );
    }
    result.improvedSpec = improvedSpec;
  }
  return result;
}

async function readFailedTask(taskTracker: TaskTrackerPort, taskId: string): Promise<TaskRecord> {
  const oldTask = await taskTracker.get(taskId);
  if (oldTask === null) {
    throw new LinnsyError(LINNSY_ERROR_CODES.TASK_NOT_FOUND, `task ${taskId} was not found`, false);
  }
  if (oldTask.status !== 'failed') {
    throw new LinnsyError(
      LINNSY_ERROR_CODES.TASK_TRANSITION_INVALID,
      `redelegate_task requires a failed task, got ${oldTask.status}`,
      false
    );
  }
  return oldTask;
}

function readTargetDefinitionKey(oldTask: TaskRecord, input: RedelegateTaskInput): string {
  if (input.improvedSpec?.targetDefinitionKey !== undefined) {
    return normalizeExternalAgentDefinitionKey(input.improvedSpec.targetDefinitionKey);
  }
  const value = oldTask.payload?.definitionKey;
  if (typeof value === 'string' && value.trim().length > 0) {
    return normalizeExternalAgentDefinitionKey(value);
  }
  throw invalidArgument(`redelegate_task cannot infer targetDefinitionKey for task ${oldTask.taskId}`);
}

function assertDefinitionKind(
  metadata: Record<string, unknown> | undefined,
  definitionKey: string,
  kind: TaskKind
): void {
  const expectedKind = kind === 'external' ? 'external_adapter' : 'internal_subagent';
  if (metadata?.kind !== expectedKind) {
    throw new LinnsyError(
      LINNSY_ERROR_CODES.DEFINITION_INVALID,
      `agent definition ${definitionKey} is not compatible with ${kind}`,
      false
    );
  }
}

function buildPayload(
  oldTask: TaskRecord,
  input: RedelegateTaskInput,
  definitionKey: string
): Record<string, unknown> {
  return {
    ...(oldTask.payload ?? {}),
    ...(input.improvedSpec?.payload ?? {}),
    definitionKey,
    ...(oldTask.kind === 'internal_subagent'
      ? { goal: input.improvedSpec?.title ?? readInternalGoal(oldTask.title, oldTask.payload ?? {}) }
      : {})
  };
}

function readRedelegateLocator(oldTask: TaskRecord, input: RedelegateTaskInput): TaskLocator | undefined {
  if (input.improvedSpec?.locator !== undefined) {
    return input.improvedSpec.locator;
  }
  if (oldTask.kind === 'external') {
    return readRequiredExternalLocator(oldTask.locator, oldTask.taskId);
  }
  return oldTask.locator;
}

function readRequiredExternalLocator(locator: TaskLocator | undefined, taskId: string): TaskLocator {
  if (locator === undefined) {
    throw new LinnsyError(
      LINNSY_ERROR_CODES.TASK_LOCATOR_INVALID,
      `external task ${taskId} requires locator`,
      false
    );
  }
  return locator;
}

function withOptionalOriginRunId(value: TaskUpsertInput, originRunId: string | undefined): TaskUpsertInput {
  if (originRunId !== undefined) {
    value.originRunId = originRunId;
  }
  return value;
}

function withOptionalDispatchPayload(
  value: ExternalAgentDispatchInput,
  payload: Record<string, unknown>
): ExternalAgentDispatchInput {
  const dispatchPayload = omitDefinitionKey(payload);
  if (Object.keys(dispatchPayload).length > 0) {
    value.payload = dispatchPayload;
  }
  return value;
}

function buildInternalRunInput(
  input: Omit<InternalSubAgentRunInput, 'context'>,
  payload: Record<string, unknown>
): InternalSubAgentRunInput {
  const context = payload.context;
  if (typeof context === 'string' && context.trim().length > 0) {
    return { ...input, context };
  }
  return input;
}

function readInternalGoal(fallback: string, payload: Record<string, unknown>): string {
  const goal = payload.goal;
  return typeof goal === 'string' && goal.trim().length > 0 ? goal : fallback;
}

async function notifyRedelegateLimit(
  notification: LinnsyNotificationLayer | undefined,
  task: TaskRecord
): Promise<void> {
  if (notification === undefined) {
    return;
  }
  await notification.notifyForTask({
    taskId: task.taskId,
    text: `我让 ${task.title} 试了两次都不对，要不你看看？`
  });
}

function omitDefinitionKey(payload: Record<string, unknown>): Record<string, unknown> {
  const result = { ...payload };
  delete result.definitionKey;
  return result;
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidArgument(`redelegate_task ${label} must be a non-empty string`);
  }
  return value.trim();
}

function invalidArgument(message: string): LinnsyError {
  return new LinnsyError(LINNSY_ERROR_CODES.RUN_EXECUTOR_FAILED, message, false);
}

function defaultTaskIdFactory(): string {
  return `task_${randomUUID()}`;
}
