import {
  createFenceRegistry,
  type FenceDescriptor,
  type FenceInjection,
  type FenceRegistry
} from '@linnlabs/linnkit/context-manager';

import type { TaskRecord, TaskStatus } from '../../../task/definitions/task.js';

export const LINNSY_FENCE_KINDS = {
  userRequest: 'user-request',
  systemEvent: 'system-event',
  subagentSummary: 'subagent-summary',
  userInterjection: 'user-interjection',
  memoryContext: 'memory-context',
  turnContext: 'turn-context'
} as const;

export type LinnsyFenceKind = typeof LINNSY_FENCE_KINDS[keyof typeof LINNSY_FENCE_KINDS];

export interface LinnsyUserRequestAttrs extends Record<string, unknown> {
  source: 'owner-message';
  messageId?: string;
  receivedAt?: number;
}

export interface LinnsySystemEventAttrs extends Record<string, unknown> {
  kind: string;
  jobId?: string;
  taskId?: string;
  vendor?: string;
  status?: Extract<TaskStatus, 'completed' | 'failed' | 'cancelled'>;
  locator?: string;
  finalMessage?: string;
  errorMessage?: string;
  cancelReason?: string;
  firedAt?: number;
}

export interface LinnsySubagentSummaryAttrs extends Record<string, unknown> {
  taskId: string;
  childRunId?: string;
  childConversationId?: string;
}

export interface LinnsyUserInterjectionAttrs extends Record<string, unknown> {
  source: 'owner-message';
  messageId?: string;
  receivedAt?: number;
}

export interface LinnsyMemoryContextAttrs extends Record<string, unknown> {
  source: 'memory-store';
  count: number;
}

export interface LinnsyTurnContextAttrs extends Record<string, unknown> {
  source: 'daemon';
  kind: 'current-time';
  generatedAt: number;
}

let defaultRegistry: FenceRegistry | undefined;

export function createLinnsyFenceRegistry(): FenceRegistry {
  return createFenceRegistry(createLinnsyFenceDescriptors());
}

export function getDefaultLinnsyFenceRegistry(): FenceRegistry {
  if (defaultRegistry === undefined) {
    defaultRegistry = createLinnsyFenceRegistry();
  }
  return defaultRegistry;
}

export function createLinnsyFenceDescriptors(): FenceDescriptor[] {
  return [
    {
      kind: LINNSY_FENCE_KINDS.userRequest,
      llmRole: 'user',
      placement: 'before-current-user',
      lifetime: 'persisted',
      mustKeep: true,
      formatter: (content, attrs) => formatFence('user_request', content, attrs)
    },
    {
      kind: LINNSY_FENCE_KINDS.turnContext,
      llmRole: 'user',
      placement: 'before-current-user',
      lifetime: 'persisted',
      mustKeep: true,
      formatter: (content, attrs) => formatFence('turn-context', content, attrs)
    },
    {
      kind: LINNSY_FENCE_KINDS.systemEvent,
      llmRole: 'user',
      placement: 'before-current-user',
      lifetime: 'persisted',
      mustKeep: true,
      formatter: (content, attrs) => formatFence('system-event', content, attrs)
    },
    {
      kind: LINNSY_FENCE_KINDS.subagentSummary,
      llmRole: 'user',
      placement: 'before-current-user',
      lifetime: 'persisted',
      mustKeep: true,
      formatter: (content, attrs) => formatFence('subagent-summary', content, attrs)
    },
    {
      kind: LINNSY_FENCE_KINDS.userInterjection,
      llmRole: 'user',
      placement: 'after-last-tool-result',
      lifetime: 'persisted',
      mustKeep: true,
      formatter: (content, attrs) => formatFence('user-interjection', content, attrs)
    },
    {
      kind: LINNSY_FENCE_KINDS.memoryContext,
      llmRole: 'user',
      placement: 'before-current-user',
      // 当前 linnkit 的 turn-only 清理会把 before-current-user 同轮注入误判成历史消息；
      // 这里保持请求级生成，不写入历史，因此用 persisted 只表示“通过本轮净化”。
      lifetime: 'persisted',
      mustKeep: true,
      formatter: (content, attrs) => formatFence('memory-context', content, attrs)
    }
  ];
}

export function createLinnsyUserRequestFence(
  content: string,
  attrs: LinnsyUserRequestAttrs
): FenceInjection {
  return {
    kind: LINNSY_FENCE_KINDS.userRequest,
    content,
    attrs
  };
}

export function createLinnsySystemEventFence(
  content: string,
  attrs: LinnsySystemEventAttrs
): FenceInjection {
  return {
    kind: LINNSY_FENCE_KINDS.systemEvent,
    content,
    attrs
  };
}

export function createLinnsySubagentSummaryFence(
  content: string,
  attrs: LinnsySubagentSummaryAttrs
): FenceInjection {
  return {
    kind: LINNSY_FENCE_KINDS.subagentSummary,
    content,
    attrs
  };
}

export function createLinnsyTaskStatusChangeFence(task: TaskRecord): FenceInjection {
  const status = readTerminalTaskStatus(task.status);
  const content = readTaskCompletedContent(task);
  const attrs: LinnsySystemEventAttrs = {
    kind: 'task_status_change',
    taskId: task.taskId,
    vendor: task.externalKind ?? task.kind,
    status
  };
  const locator = formatTaskLocator(task);
  if (locator !== undefined) {
    attrs.locator = locator;
  }
  if (status === 'completed') {
    const finalMessage = readStringField(task.result, 'finalMessage') ?? readStringField(task.result, 'finalAnswer');
    if (finalMessage !== undefined) {
      attrs.finalMessage = finalMessage;
    }
  } else if (status === 'failed') {
    const errorMessage = readStringField(task.result, 'errorMessage');
    if (errorMessage !== undefined) {
      attrs.errorMessage = errorMessage;
    }
  } else if (task.cancelReason !== undefined) {
    attrs.cancelReason = task.cancelReason;
  }
  return {
    kind: LINNSY_FENCE_KINDS.systemEvent,
    content,
    attrs
  };
}

export function createLinnsyUserInterjectionFence(
  content: string,
  attrs: LinnsyUserInterjectionAttrs
): FenceInjection {
  return {
    kind: LINNSY_FENCE_KINDS.userInterjection,
    content,
    attrs
  };
}

export function createLinnsyMemoryContextFence(
  content: string,
  attrs: LinnsyMemoryContextAttrs
): FenceInjection {
  return {
    kind: LINNSY_FENCE_KINDS.memoryContext,
    content,
    attrs
  };
}

export function createLinnsyTurnContextFence(
  content: string,
  attrs: LinnsyTurnContextAttrs
): FenceInjection {
  return {
    kind: LINNSY_FENCE_KINDS.turnContext,
    content,
    attrs
  };
}

function formatFence(tag: string, content: string, attrs: Record<string, unknown>): string {
  const attrText = formatAttrs(attrs);
  const openTag = attrText.length === 0 ? `<${tag}>` : `<${tag} ${attrText}>`;
  return `${openTag}\n${content}\n</${tag}>`;
}

function formatAttrs(attrs: Record<string, unknown>): string {
  return Object.entries(attrs)
    .filter((entry): entry is [string, string | number | boolean] => {
      const value = entry[1];
      return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
    })
    .map(([key, value]) => `${key}="${escapeAttr(String(value))}"`)
    .join(' ');
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function readTerminalTaskStatus(status: TaskStatus): NonNullable<LinnsySystemEventAttrs['status']> {
  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    return status;
  }
  throw new Error(`task status system-event requires terminal task status, got ${status}`);
}

function readTaskCompletedContent(task: TaskRecord): string {
  if (task.status === 'completed') {
    return readStringField(task.result, 'finalMessage')
      ?? readStringField(task.result, 'finalAnswer')
      ?? 'Task completed without a final message.';
  }
  if (task.status === 'failed') {
    return readStringField(task.result, 'errorMessage') ?? 'Task failed without an error message.';
  }
  if (task.status === 'cancelled') {
    return task.cancelReason ?? 'Task was cancelled.';
  }
  return 'Task reached a non-terminal status.';
}

function readStringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function formatTaskLocator(task: TaskRecord): string | undefined {
  if (task.locator === undefined) {
    return undefined;
  }
  if (task.locator.ref === undefined || task.locator.ref.trim().length === 0) {
    return task.locator.label;
  }
  return `${task.locator.label}(${task.locator.ref})`;
}
