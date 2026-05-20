import type { OpenAIToolSchema, ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../shared/errors.js';
import type {
  CodexThreadMetadata,
  CodexThreadProject
} from '../../../../../shared/dto/codex-session.js';
import type { LinnsyAgentRegistryPort } from '../../agents/registry/types.js';
import type { TaskLocator, TaskRecord, TaskUpsertInput } from '../../../../task/definitions/task.js';
import {
  assertCodexCwdDirectory,
  readCodexCwd
} from '../../../../task/features/external-dispatch/codex/codex-locator.js';
import type { CodexSessionBridgePort } from '../../../../task/features/external-dispatch/codex/codex-session-bridge.js';
import {
  normalizeExternalAgentDefinitionKey,
  resolveExternalAgentKind
} from '../../../../task/features/external-dispatch/vendor-kind.js';
import { readTaskLocator } from '../../../../task/features/lifecycle/functions/task-locator.js';
import type { WorkspacePort } from '../../../../task/features/workspace/definitions/types.js';
import type { TaskTrackerPort } from '../../../../task/ports/task-tracker-port.js';
import { toJsonObjectSchema, type LinnsyTool, type StructuredToolResult } from '../types.js';

export type ManageExternalSessionAction = 'list_projects' | 'list_threads' | 'attach';

export interface ManageExternalSessionOutput extends Record<string, unknown> {
  definitionKey: string;
  provider: 'codex';
  action: ManageExternalSessionAction;
  projects?: CodexThreadProject[];
  threads?: CodexThreadMetadata[];
  task?: TaskRecord;
  session?: CodexThreadMetadata;
  appliedFilter?: {
    limit: number;
    cwd?: string;
    includeChildDirectories: boolean;
    includeAllProjects: boolean;
  };
}

export interface CreateManageExternalSessionToolOptions {
  registry: LinnsyAgentRegistryPort;
  taskTracker: TaskTrackerPort;
  workspace: WorkspacePort;
  codexSessionBridge: CodexSessionBridgePort;
  taskIdFactory?: () => string;
  now?: () => number;
}

export function createManageExternalSessionTool(options: CreateManageExternalSessionToolOptions): LinnsyTool & {
  execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<StructuredToolResult<ManageExternalSessionOutput>>;
} {
  const taskIdFactory = options.taskIdFactory ?? defaultTaskIdFactory;
  const now = options.now ?? Date.now;

  return {
    name: 'manage_external_session',
    description: 'List or attach resumable external-agent sessions. For Codex, always choose the project cwd before selecting a thread.',
    definition: {
      parameters: {
        type: 'object',
        required: ['action', 'definitionKey'],
        additionalProperties: false,
        properties: {
          action: {
            type: 'string',
            enum: ['list_projects', 'list_threads', 'attach'],
            description: 'list_projects lists Codex cwd groups; list_threads lists histories for one cwd; attach creates a Linnsy task from a selected session.'
          },
          definitionKey: {
            type: 'string',
            description: 'External agent definition key. Use delegate_to_codex for Codex history.'
          },
          locator: {
            type: 'object',
            description: 'Project locator for action=list_threads. For Codex use kind=directory and ref as the absolute project cwd.'
          },
          includeChildDirectories: {
            type: 'boolean',
            description: 'For action=list_threads, include sessions whose cwd is below locator.ref. Default false.'
          },
          includeAllProjects: {
            type: 'boolean',
            description: 'For action=list_threads only. Set true only when the owner explicitly asks to search all Codex projects.'
          },
          limit: {
            type: 'number',
            description: 'Maximum number of projects or threads to return, clamped to 100.'
          },
          sessionId: {
            type: 'string',
            description: 'Existing external session id for action=attach.'
          },
          title: {
            type: 'string',
            description: 'Optional human-readable Linnsy task title for action=attach. Defaults to the Codex thread name.'
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
    async execute(args, context): Promise<StructuredToolResult<ManageExternalSessionOutput>> {
      const input = readInput(args);
      options.registry.assertAgent(input.definitionKey);
      assertCodexDefinition(input.definitionKey);

      if (input.action === 'list_projects') {
        return listProjects(options.codexSessionBridge, input);
      }
      if (input.action === 'list_threads') {
        return listThreads(options.codexSessionBridge, input);
      }
      return attachSession({
        options,
        context,
        input,
        taskIdFactory,
        now
      });
    }
  };
}

interface ManageExternalSessionInput {
  action: ManageExternalSessionAction;
  definitionKey: string;
  limit: number;
  cwd?: string;
  includeChildDirectories: boolean;
  includeAllProjects: boolean;
  sessionId?: string;
  title?: string;
}

function readInput(args: Record<string, unknown>): ManageExternalSessionInput {
  const definitionKey = normalizeExternalAgentDefinitionKey(readNonEmptyString(args.definitionKey, 'definitionKey'));
  const action = readAction(args.action);
  const locator = args.locator === undefined
    ? undefined
    : readTaskLocator(args.locator, 'manage_external_session locator');
  const title = args.title === undefined ? undefined : readNonEmptyString(args.title, 'title');
  const result: ManageExternalSessionInput = {
    action,
    definitionKey,
    limit: readLimit(args.limit),
    includeChildDirectories: readBoolean(args.includeChildDirectories, false, 'includeChildDirectories'),
    includeAllProjects: readBoolean(args.includeAllProjects, false, 'includeAllProjects'),
    ...(title === undefined ? {} : { title })
  };
  if (locator !== undefined) {
    result.cwd = readDirectoryRef(locator);
  }
  if (args.sessionId !== undefined) {
    result.sessionId = readNonEmptyString(args.sessionId, 'sessionId');
  }
  validateActionInput(result);
  return result;
}

async function listProjects(
  codexSessionBridge: CodexSessionBridgePort,
  input: ManageExternalSessionInput
): Promise<StructuredToolResult<ManageExternalSessionOutput>> {
  const projects = await codexSessionBridge.listProjects({ limit: input.limit });
  return {
    data: {
      definitionKey: input.definitionKey,
      provider: 'codex',
      action: 'list_projects',
      projects,
      appliedFilter: buildAppliedFilter(input)
    },
    observation: buildProjectsObservation(projects)
  };
}

async function listThreads(
  codexSessionBridge: CodexSessionBridgePort,
  input: ManageExternalSessionInput
): Promise<StructuredToolResult<ManageExternalSessionOutput>> {
  const threads = await codexSessionBridge.listRecentThreads({
    limit: input.limit,
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    includeChildDirectories: input.includeChildDirectories
  });
  return {
    data: {
      definitionKey: input.definitionKey,
      provider: 'codex',
      action: 'list_threads',
      threads,
      appliedFilter: buildAppliedFilter(input)
    },
    observation: buildThreadsObservation(threads, input.cwd)
  };
}

async function attachSession(input: {
  options: CreateManageExternalSessionToolOptions;
  context: ToolExecutionContext;
  input: ManageExternalSessionInput;
  taskIdFactory: () => string;
  now: () => number;
}): Promise<StructuredToolResult<ManageExternalSessionOutput>> {
  const sessionId = input.input.sessionId;
  if (sessionId === undefined) {
    throw invalidArgument('manage_external_session action=attach requires sessionId');
  }
  const session = await input.options.codexSessionBridge.getThread(sessionId);
  if (session === null) {
    throw new LinnsyError(
      LINNSY_ERROR_CODES.EXTERNAL_SESSION_NOT_FOUND,
      `Codex session ${sessionId} was not found`,
      false
    );
  }
  const locator = buildCodexHistoryLocator(session);
  const cwd = readCodexCwd(locator);
  await assertCodexCwdDirectory(cwd);

  const conversationId = readConversationId(input.context);
  const existing = await findExistingAttachedTask({
    taskTracker: input.options.taskTracker,
    conversationId,
    sessionId: session.id
  });
  if (existing !== null) {
    return {
      data: {
        definitionKey: input.input.definitionKey,
        provider: 'codex',
        action: 'attach',
        task: existing,
        session
      },
      observation: `Codex 历史对话已在当前会话接管为任务 ${existing.taskId}，可直接用 manage_task action=continue 继续。sessionId=${session.id}，cwd=${cwd}。`
    };
  }

  const taskId = input.taskIdFactory();
  const workspacePath = await input.options.workspace.create(taskId);
  const timestamp = input.now();
  const task = await input.options.taskTracker.upsert(withOptionalOriginRunId({
    taskId,
    conversationId,
    title: input.input.title ?? session.threadName ?? `Codex 历史对话 ${session.id.slice(0, 8)}`,
    status: 'completed',
    kind: 'external',
    externalKind: 'codex',
    externalRef: session.id,
    locator,
    attemptCount: 1,
    workspacePath,
    payload: buildAttachedPayload(input.input.definitionKey, session, timestamp),
    metadata: {
      source: 'codex_history',
      attachedFrom: 'manage_external_session'
    },
    completedAt: timestamp
  }, input.context.runId));

  return {
    data: {
      definitionKey: input.input.definitionKey,
      provider: 'codex',
      action: 'attach',
      task,
      session
    },
    observation: `已接管 Codex 历史对话为 Linnsy 任务 ${task.taskId}。sessionId=${session.id}，cwd=${cwd}，下一步用 manage_task(action=continue, taskId=${task.taskId}) 继续对话。`
  };
}

function validateActionInput(input: ManageExternalSessionInput): void {
  if (input.action === 'list_projects') {
    return;
  }
  if (input.action === 'list_threads') {
    if (input.cwd === undefined && !input.includeAllProjects) {
      throw invalidArgument('manage_external_session action=list_threads requires locator unless includeAllProjects=true');
    }
    if (input.cwd !== undefined && input.includeAllProjects) {
      throw invalidArgument('manage_external_session action=list_threads cannot combine locator with includeAllProjects=true');
    }
    return;
  }
  if (input.sessionId === undefined) {
    throw invalidArgument('manage_external_session action=attach requires sessionId');
  }
}

function buildAppliedFilter(input: ManageExternalSessionInput): {
  limit: number;
  cwd?: string;
  includeChildDirectories: boolean;
  includeAllProjects: boolean;
} {
  return {
    limit: input.limit,
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    includeChildDirectories: input.includeChildDirectories,
    includeAllProjects: input.includeAllProjects
  };
}

function readAction(value: unknown): ManageExternalSessionAction {
  if (value === 'list_projects' || value === 'list_threads' || value === 'attach') {
    return value;
  }
  throw invalidArgument('manage_external_session action must be list_projects, list_threads, or attach');
}

function readDirectoryRef(locator: TaskLocator): string {
  if (locator.kind !== 'directory' || locator.ref === undefined || locator.ref.trim().length === 0) {
    throw invalidArgument('manage_external_session locator must use kind=directory with a non-empty ref');
  }
  return locator.ref.trim();
}

function assertCodexDefinition(definitionKey: string): void {
  if (resolveExternalAgentKind(definitionKey) !== 'codex') {
    throw invalidArgument('manage_external_session currently supports only delegate_to_codex');
  }
}

function buildCodexHistoryLocator(session: CodexThreadMetadata): TaskLocator {
  if (session.cwd === undefined || session.cwd.trim().length === 0) {
    throw new LinnsyError(
      LINNSY_ERROR_CODES.TASK_LOCATOR_INVALID,
      `Codex session ${session.id} does not include cwd metadata`,
      false
    );
  }
  const cwd = session.cwd.trim();
  return {
    kind: 'directory',
    label: basename(cwd) || cwd,
    ref: cwd,
    meta: {
      source: 'codex_history',
      codexSessionId: session.id
    }
  };
}

function buildAttachedPayload(
  definitionKey: string,
  session: CodexThreadMetadata,
  attachedAt: number
): Record<string, unknown> {
  return {
    definitionKey,
    source: 'codex_history',
    codexSessionId: session.id,
    codexThreadName: session.threadName ?? null,
    codexUpdatedAt: session.updatedAt,
    attachedAt,
    prompt: `继续已有 Codex 历史对话 ${session.id}。`
  };
}

async function findExistingAttachedTask(input: {
  taskTracker: TaskTrackerPort;
  conversationId: string;
  sessionId: string;
}): Promise<TaskRecord | null> {
  const tasks = await input.taskTracker.list({
    conversationId: input.conversationId,
    status: ['received', 'dispatched', 'in_progress', 'paused', 'completed', 'reported', 'archived', 'failed', 'cancelled'],
    kind: 'external',
    limit: 100
  });
  return tasks.find((task) => task.externalKind === 'codex' && task.externalRef === input.sessionId) ?? null;
}

function buildProjectsObservation(projects: CodexThreadProject[]): string {
  const lines = [
    `已列出 ${String(projects.length)} 个 Codex 项目历史分组。先让主人确认项目目录，再列该项目下的对话。`
  ];
  if (projects.length > 0) {
    lines.push('项目列表：');
    lines.push(...projects.map((project) => (
      `- ${project.label} | cwd=${project.cwd} | threads=${String(project.threadCount)} | latestUpdatedAt=${String(project.latestUpdatedAt)}`
    )));
  }
  return lines.join('\n');
}

function buildThreadsObservation(threads: CodexThreadMetadata[], cwd: string | undefined): string {
  const scope = cwd === undefined ? 'all_projects' : `cwd=${cwd}`;
  const lines = [`已列出 ${String(threads.length)} 个 Codex 历史对话，scope=${scope}。`];
  if (threads.length > 0) {
    lines.push('对话列表：');
    lines.push(...threads.map((thread) => (
      `- ${thread.threadName ?? '(未命名)'} | sessionId=${thread.id} | cwd=${thread.cwd ?? '(unknown)'} | updatedAt=${String(thread.updatedAt)}`
    )));
  }
  return lines.join('\n');
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

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidArgument(`manage_external_session ${label} must be a non-empty string`);
  }
  return value.trim();
}

function readBoolean(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'boolean') {
    throw invalidArgument(`manage_external_session ${label} must be a boolean`);
  }
  return value;
}

function readLimit(value: unknown): number {
  if (value === undefined) {
    return 20;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw invalidArgument('manage_external_session limit must be a positive integer');
  }
  return Math.min(value, 100);
}

function readConversationId(context: ToolExecutionContext): string {
  if (typeof context.conversationId === 'string' && context.conversationId.trim().length > 0) {
    return context.conversationId;
  }
  throw invalidArgument('manage_external_session action=attach requires conversationId in tool context');
}

function invalidArgument(message: string): LinnsyError {
  return new LinnsyError(LINNSY_ERROR_CODES.RUN_EXECUTOR_FAILED, message, false);
}

function defaultTaskIdFactory(): string {
  return `task_${randomUUID()}`;
}
