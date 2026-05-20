import type { OpenAIToolSchema, ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';
import { randomUUID } from 'node:crypto';

import type { LinnsyPathManager } from '../../../../../config/path-manager.js';
import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../shared/errors.js';
import { isRecord } from '../../../../../shared/json.js';
import type { LinnsyAgentRegistryPort } from '../../agents/registry/types.js';
import type { ExternalAgentDispatcherPort, ExternalAgentDispatchInput } from '../../../../task/features/external-dispatch/types.js';
import {
  externalAgentKindUsesDirectoryLocator,
  normalizeExternalAgentDefinitionKey,
  resolveExternalAgentKind
} from '../../../../task/features/external-dispatch/vendor-kind.js';
import type { TaskLocator, TaskUpsertInput } from '../../../../task/definitions/task.js';
import { readTaskLocator } from '../../../../task/features/lifecycle/functions/task-locator.js';
import type { TaskTrackerPort } from '../../../../task/ports/task-tracker-port.js';
import type { WorkspacePort } from '../../../../task/features/workspace/definitions/types.js';
import { toJsonObjectSchema, type LinnsyTool, type StructuredToolResult } from '../types.js';

export interface DelegateToExternalInput {
  definitionKey: string;
  title: string;
  locator?: TaskLocator;
  payload?: Record<string, unknown>;
}

export interface DelegateToExternalOutput extends Record<string, unknown> {
  taskId: string;
  locator: TaskLocator;
  workspacePath: string;
  status: 'dispatched';
}

export interface CreateDelegateToExternalToolOptions {
  registry: LinnsyAgentRegistryPort;
  taskTracker: TaskTrackerPort;
  workspace: WorkspacePort;
  dispatcher: ExternalAgentDispatcherPort;
  pathManager?: LinnsyPathManager;
  taskIdFactory?: () => string;
}

export function createDelegateToExternalTool(options: CreateDelegateToExternalToolOptions): LinnsyTool & {
  execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<StructuredToolResult<DelegateToExternalOutput>>;
} {
  const taskIdFactory = options.taskIdFactory ?? defaultTaskIdFactory;

  return {
    name: 'delegate_to_external',
    description: 'Delegate a long-running task to a registered external agent adapter.',
    definition: {
      parameters: {
        type: 'object',
        required: ['definitionKey', 'title'],
        additionalProperties: false,
        properties: {
          definitionKey: {
            type: 'string',
            description: 'Registered external agent definition key. Use delegate_to_codex for Codex; known short aliases such as codex are canonicalized.'
          },
          title: {
            type: 'string',
            description: 'Human-readable task title.'
          },
          locator: {
            type: 'object',
            description: 'Vendor-neutral task location. Use kind=directory with label and ref for existing Codex projects. Omit only for artifact/output tasks that may use Linnsy Work.'
          },
          payload: {
            type: 'object',
            description: 'Task payload passed to the external agent. For delegate_to_codex, include prompt; location belongs in locator, not payload.cwd.'
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
    async execute(args, context): Promise<StructuredToolResult<DelegateToExternalOutput>> {
      const input = readInput(args);
      options.registry.assertAgent(input.definitionKey);
      const conversationId = readConversationId(context);
      const taskId = taskIdFactory();
      const workspacePath = await options.workspace.create(taskId);
      const externalKind = resolveExternalAgentKind(input.definitionKey);
      const locator = await resolveTaskLocator({
        input,
        externalKind,
        pathManager: options.pathManager
      });

      await options.taskTracker.upsert(withOptionalOriginRunId({
        taskId,
        conversationId,
        title: input.title,
        status: 'received',
        kind: 'external',
        ...(externalKind === undefined ? {} : { externalKind }),
        locator,
        attemptCount: 1,
        workspacePath,
        payload: buildTaskPayload(input.definitionKey, input.payload)
      }, context.runId));
      await options.taskTracker.transition(taskId, 'dispatched');
      try {
        await options.dispatcher.dispatch(withOptionalDispatchPayload({
          taskId,
          definitionKey: input.definitionKey,
          locator,
          workspacePath
        }, input.payload));
      } catch (error: unknown) {
        await options.taskTracker.transition(taskId, 'failed', {
          result: { errorMessage: error instanceof Error ? error.message : String(error) }
        });
        throw error;
      }

      const data: DelegateToExternalOutput = {
        taskId,
        locator,
        workspacePath,
        status: 'dispatched'
      };
      return {
        data,
        observation: `已派发外部任务 ${taskId}，status=dispatched，位置=${formatObservationLocator(locator)}，workspacePath=${workspacePath}。`
      };
    }
  };
}

function readInput(args: Record<string, unknown>): DelegateToExternalInput {
  const definitionKey = normalizeExternalAgentDefinitionKey(readNonEmptyString(args.definitionKey, 'definitionKey'));
  const title = readNonEmptyString(args.title, 'title');
  const result: DelegateToExternalInput = { definitionKey, title };
  if (args.locator !== undefined) {
    result.locator = readTaskLocator(args.locator, 'delegate_to_external locator');
  }
  if (args.payload !== undefined) {
    if (!isRecord(args.payload)) {
      throw new LinnsyError(
        LINNSY_ERROR_CODES.RUN_EXECUTOR_FAILED,
        'delegate_to_external payload must be an object',
        false
      );
    }
    result.payload = args.payload;
  }
  return result;
}

async function resolveTaskLocator(input: {
  input: DelegateToExternalInput;
  externalKind: ReturnType<typeof resolveExternalAgentKind>;
  pathManager: LinnsyPathManager | undefined;
}): Promise<TaskLocator> {
  if (input.input.locator !== undefined) {
    return input.input.locator;
  }
  if (!externalAgentKindUsesDirectoryLocator(input.externalKind)) {
    throw new LinnsyError(
      LINNSY_ERROR_CODES.TASK_LOCATOR_INVALID,
      'delegate_to_external locator is required for this external agent',
      false
    );
  }
  if (input.pathManager === undefined) {
    throw new LinnsyError(
      LINNSY_ERROR_CODES.TASK_LOCATOR_INVALID,
      'delegate_to_external needs pathManager to create a Linnsy Work directory',
      false
    );
  }

  const workDirectory = await input.pathManager.createDefaultUserWorkDirectory({
    title: input.input.title,
    ...withOptionalPrompt(readOptionalPrompt(input.input.payload))
  });
  return {
    kind: 'directory',
    label: workDirectory.label,
    ref: workDirectory.directory,
    meta: {
      source: 'linnsy_work',
      root: workDirectory.root,
      slug: workDirectory.slug
    }
  };
}

function readOptionalPrompt(payload: Record<string, unknown> | undefined): string | undefined {
  const value = payload?.prompt;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function formatObservationLocator(locator: TaskLocator): string {
  return locator.ref === undefined ? locator.label : `${locator.label}(${locator.ref})`;
}

function withOptionalPrompt(prompt: string | undefined): { prompt: string } | Record<string, never> {
  return prompt === undefined ? {} : { prompt };
}

function withOptionalOriginRunId(
  value: TaskUpsertInput,
  originRunId: string | undefined
): TaskUpsertInput {
  if (originRunId !== undefined) {
    value.originRunId = originRunId;
  }
  return value;
}

function buildTaskPayload(
  definitionKey: string,
  payload: Record<string, unknown> | undefined
): Record<string, unknown> {
  return {
    ...(payload ?? {}),
    definitionKey
  };
}

function withOptionalDispatchPayload(
  value: ExternalAgentDispatchInput,
  payload: Record<string, unknown> | undefined
): ExternalAgentDispatchInput {
  if (payload !== undefined) {
    const dispatchPayload = omitDefinitionKey(payload);
    if (Object.keys(dispatchPayload).length > 0) {
      value.payload = dispatchPayload;
    }
  }
  return value;
}

function omitDefinitionKey(payload: Record<string, unknown>): Record<string, unknown> {
  const result = { ...payload };
  delete result.definitionKey;
  return result;
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new LinnsyError(
      LINNSY_ERROR_CODES.RUN_EXECUTOR_FAILED,
      `delegate_to_external ${label} must be a non-empty string`,
      false
    );
  }
  return value.trim();
}

function readConversationId(context: ToolExecutionContext): string {
  if (typeof context.conversationId === 'string' && context.conversationId.trim().length > 0) {
    return context.conversationId;
  }
  throw new LinnsyError(
    LINNSY_ERROR_CODES.RUN_EXECUTOR_FAILED,
    'delegate_to_external requires conversationId in tool context',
    false
  );
}

function defaultTaskIdFactory(): string {
  return `task_${randomUUID()}`;
}
