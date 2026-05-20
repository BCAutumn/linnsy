import type { OpenAIToolSchema, ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';
import { randomUUID } from 'node:crypto';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../shared/errors.js';
import type { LinnsyAgentRegistryPort } from '../../agents/registry/types.js';
import type { InternalSubAgentRunInput, InternalSubAgentRunner } from '../../internal-subagent/types.js';
import type { TaskUpsertInput } from '../../../../task/definitions/task.js';
import type { TaskTrackerPort } from '../../../../task/ports/task-tracker-port.js';
import type { WorkspacePort } from '../../../../task/features/workspace/definitions/types.js';
import { toJsonObjectSchema, type LinnsyTool, type StructuredToolResult } from '../types.js';

export interface DelegateToInternalInput {
  definitionKey: string;
  goal: string;
  context?: string;
}

export interface DelegateToInternalOutput extends Record<string, unknown> {
  taskId: string;
  workspacePath: string;
  status: 'dispatched';
}

export interface CreateDelegateToInternalToolOptions {
  registry: LinnsyAgentRegistryPort;
  taskTracker: TaskTrackerPort;
  workspace: WorkspacePort;
  runner: InternalSubAgentRunner;
  taskIdFactory?: () => string;
}

const maxInternalContextChars = 64 * 1024;

export function createDelegateToInternalTool(options: CreateDelegateToInternalToolOptions): LinnsyTool & {
  execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<StructuredToolResult<DelegateToInternalOutput>>;
} {
  const taskIdFactory = options.taskIdFactory ?? defaultTaskIdFactory;

  return {
    name: 'delegate_to_internal',
    description: 'Delegate a task to a Linnsy-managed internal subagent.',
    definition: {
      parameters: {
        type: 'object',
        required: ['definitionKey', 'goal'],
        additionalProperties: false,
        properties: {
          definitionKey: {
            type: 'string',
            description: 'Registered internal subagent definition key.'
          },
          goal: {
            type: 'string',
            description: 'Goal for the internal subagent.'
          },
          context: {
            type: 'string',
            description: 'Optional explicit context for the internal subagent.'
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
    async execute(args, context): Promise<StructuredToolResult<DelegateToInternalOutput>> {
      const input = readInput(args);
      const definition = options.registry.assertAgent(input.definitionKey);
      assertInternalSubagentDefinition(definition.metadata, input.definitionKey);
      const conversationId = readConversationId(context);
      const taskId = taskIdFactory();
      const workspacePath = await options.workspace.create(taskId);

      await options.taskTracker.upsert(withOptionalContext({
        taskId,
        conversationId,
        title: input.goal,
        status: 'received',
        kind: 'internal_subagent',
        attemptCount: 1,
        workspacePath,
        payload: {
          definitionKey: input.definitionKey,
          goal: input.goal
        }
      }, input.context, context.runId));
      await options.taskTracker.transition(taskId, 'dispatched');
      options.runner.spawn(withOptionalContextForRun({
        taskId,
        definitionKey: input.definitionKey,
        goal: input.goal,
        workspacePath,
        parentConversationId: conversationId,
        ...(context.runId === undefined ? {} : { parentRunId: context.runId })
      }, input.context));

      const data: DelegateToInternalOutput = {
        taskId,
        workspacePath,
        status: 'dispatched'
      };
      return {
        data,
        observation: `已派发内部子任务 ${taskId}，status=dispatched，workspacePath=${workspacePath}。`
      };
    }
  };
}

function readInput(args: Record<string, unknown>): DelegateToInternalInput {
  const definitionKey = readNonEmptyString(args.definitionKey, 'definitionKey');
  const goal = readNonEmptyString(args.goal, 'goal');
  const result: DelegateToInternalInput = { definitionKey, goal };
  if (args.context !== undefined) {
    result.context = readBoundedContext(args.context);
  }
  return result;
}

function assertInternalSubagentDefinition(metadata: Record<string, unknown> | undefined, definitionKey: string): void {
  if (metadata?.kind !== 'internal_subagent') {
    throw new LinnsyError(
      LINNSY_ERROR_CODES.DEFINITION_INVALID,
      `agent definition ${definitionKey} is not an internal subagent`,
      false
    );
  }
}

function withOptionalContext(
  value: TaskUpsertInput,
  context: string | undefined,
  originRunId: string | undefined
): TaskUpsertInput {
  if (context !== undefined) {
    value.payload = {
      ...(value.payload ?? {}),
      context
    };
  }
  if (originRunId !== undefined) {
    value.originRunId = originRunId;
  }
  return value;
}

function withOptionalContextForRun(
  value: Omit<InternalSubAgentRunInput, 'context'>,
  context: string | undefined
): InternalSubAgentRunInput {
  if (context !== undefined) {
    return { ...value, context };
  }
  return value;
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new LinnsyError(
      LINNSY_ERROR_CODES.RUN_EXECUTOR_FAILED,
      `delegate_to_internal ${label} must be a non-empty string`,
      false
    );
  }
  return value;
}

function readConversationId(context: ToolExecutionContext): string {
  if (typeof context.conversationId === 'string' && context.conversationId.trim().length > 0) {
    return context.conversationId;
  }
  throw new LinnsyError(
    LINNSY_ERROR_CODES.RUN_EXECUTOR_FAILED,
    'delegate_to_internal requires conversationId in tool context',
    false
  );
}

function readBoundedContext(value: unknown): string {
  const context = readNonEmptyString(value, 'context');
  if (context.length > maxInternalContextChars) {
    throw new LinnsyError(
      LINNSY_ERROR_CODES.RUN_EXECUTOR_FAILED,
      `delegate_to_internal context must be at most ${maxInternalContextChars.toString()} characters`,
      false
    );
  }
  return context;
}

function defaultTaskIdFactory(): string {
  return `task_${randomUUID()}`;
}
