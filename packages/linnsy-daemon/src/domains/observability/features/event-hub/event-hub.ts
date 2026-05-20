import { randomUUID } from 'node:crypto';

import type {
  RuntimeEvent,
  RuntimeEventEnvelope,
  RuntimeEventPublishInput
} from '../../definitions/runtime-events.js';

export type {
  RuntimeEvent,
  RuntimeEventKind,
  RuntimeEventPublishInput
} from '../../definitions/runtime-events.js';

export interface RuntimeEventHubPort {
  publish(input: RuntimeEventPublishInput): RuntimeEvent;
  subscribe(listener: RuntimeEventListener): () => void;
  poll(options?: { since?: string; limit?: number }): RuntimeEventPollResult;
}

export type RuntimeEventListener = (event: RuntimeEvent) => void;
export type RuntimeEventPollItem = RuntimeEvent | RuntimeEventEnvelope;

export interface RuntimeEventPollResult {
  events: RuntimeEventPollItem[];
  nextCursor?: string;
}

export interface RuntimeEventPersistencePort {
  // 每次 publish 同步调用。任何抛错都会让 publish 抛错——store 必须处理重复写 / 失败。
  append(event: RuntimeEvent): void;
}

export interface RuntimeEventHistoryPort {
  // 断线重连的历史补齐必须读持久化事件表；内存 ring buffer 只承担低延迟广播和短窗口兜底。
  list(options?: { sinceSeq?: number; limit?: number }): RuntimeEventPollResult;
}

export interface CreateRuntimeEventHubOptions {
  now?: () => number;
  idFactory?: () => string;
  maxEvents?: number;
  // 启动时从持久化层读出最大 seq 后注入，避免重启后 seq 与历史冲突。
  initialSeq?: number;
  // 注入后，每条 publish 同步落库（除内存 ring buffer 外）。
  persistence?: RuntimeEventPersistencePort;
  // 注入后，poll 走持久化历史源，避免 daemon 重启或 ring buffer 溢出后断线补齐丢事件。
  history?: RuntimeEventHistoryPort;
}

export function createRuntimeEventHub(options: CreateRuntimeEventHubOptions = {}): RuntimeEventHubPort {
  const now = options.now ?? Date.now;
  const idFactory = options.idFactory ?? defaultEventIdFactory;
  const maxEvents = Math.max(1, options.maxEvents ?? 500);
  const history = options.history;
  const listeners = new Set<RuntimeEventListener>();
  const events: RuntimeEvent[] = [];
  // 启动时由持久化层读 MAX(seq) 接续，避免 daemon 重启后 seq 与历史冲突。
  let nextSeq = Math.max(1, (options.initialSeq ?? 0) + 1);

  return {
    publish(input): RuntimeEvent {
      const baseFields = {
        eventId: idFactory(),
        seq: nextSeq,
        createdAt: input.createdAt ?? now(),
        ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
        ...(input.messageId === undefined ? {} : { messageId: input.messageId }),
        ...(input.runId === undefined ? {} : { runId: input.runId })
      };
      // 用 buildEvent 通过 input.kind 收敛到正确的 union 分支，避免在外部用 `as`。
      const event = buildEvent(input, baseFields);
      nextSeq += 1;
      // 先持久化再广播：保证消费者拿到的事件已经入库（前端 hydrate 时不会比内存少一条）。
      // 持久化失败让 publish 抛错，由调用方决定如何降级。
      options.persistence?.append(event);
      events.push(event);
      if (events.length > maxEvents) {
        events.splice(0, events.length - maxEvents);
      }
      for (const listener of listeners) {
        listener(event);
      }
      return event;
    },

    subscribe(listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    poll(options = {}): RuntimeEventPollResult {
      const sinceSeq = parseCursor(options.since);
      const limit = Math.max(1, options.limit ?? 100);
      if (history !== undefined) {
        return history.list({ sinceSeq, limit });
      }
      const page = events.filter((event) => event.seq > sinceSeq).slice(0, limit);
      const result: RuntimeEventPollResult = { events: page };
      const last = page.at(-1);
      if (last !== undefined) {
        result.nextCursor = String(last.seq);
      }
      return result;
    }
  };
}

function parseCursor(value: string | undefined): number {
  if (value === undefined) {
    return 0;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function defaultEventIdFactory(): string {
  return `evt_${randomUUID()}`;
}

interface RuntimeEventBaseFields {
  eventId: string;
  seq: number;
  createdAt: number;
  conversationId?: string;
  messageId?: string;
  runId?: string;
}

// 把 publish input 按 kind 收敛到 RuntimeEvent union 的正确分支。
// 全 switch + return 的写法既保证类型穷尽（assertNever 兜底），又避免任何 `as` 断言。
function buildEvent(input: RuntimeEventPublishInput, base: RuntimeEventBaseFields): RuntimeEvent {
  switch (input.kind) {
    case 'message.inbound':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'message.delta':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'message.thought_delta':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'message.thought_complete':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'message.complete':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'run.status_change':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'tool_call.start':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'tool_call.progress':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'tool_call.result':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'subagent.progress':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'subagent.summary':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'system.event':
      return { ...base, kind: input.kind, payload: input.payload };
    default:
      return assertNever(input);
  }
}

function assertNever(value: never): never {
  throw new Error(`unhandled runtime event kind: ${JSON.stringify(value)}`);
}
