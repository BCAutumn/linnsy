import { getFlushIntervalMs } from '../features/chat/projection/settings.js';
import type { RuntimeClientEvent } from './daemon-api.js';

type TimerId = ReturnType<typeof setTimeout>;

export interface RuntimeEventBatcher {
  push(event: RuntimeClientEvent): void;
  flush(): void;
  close(): void;
}

interface RuntimeEventBatcherOptions {
  apply(events: readonly RuntimeClientEvent[]): void;
  readFlushIntervalMs?: () => number;
  setTimeoutFn?: (handler: () => void, timeout: number) => TimerId;
  clearTimeoutFn?: (timer: TimerId) => void;
}

export function createRuntimeEventBatcher(options: RuntimeEventBatcherOptions): RuntimeEventBatcher {
  const readFlushIntervalMs = options.readFlushIntervalMs ?? getFlushIntervalMs;
  const setTimeoutFn = options.setTimeoutFn ?? ((handler, timeout) => setTimeout(handler, timeout));
  const clearTimeoutFn = options.clearTimeoutFn ?? ((timer) => {
    clearTimeout(timer);
  });
  let pending: RuntimeClientEvent[] = [];
  let timer: TimerId | null = null;
  let closed = false;

  function cancelTimer(): void {
    if (timer === null) {
      return;
    }
    clearTimeoutFn(timer);
    timer = null;
  }

  function flush(): void {
    if (closed || pending.length === 0) {
      cancelTimer();
      return;
    }
    const events = pending;
    pending = [];
    cancelTimer();
    options.apply(events);
  }

  function scheduleFlush(): void {
    if (timer !== null) {
      return;
    }
    const intervalMs = readFlushIntervalMs();
    if (intervalMs === 0) {
      flush();
      return;
    }
    timer = setTimeoutFn(flush, intervalMs);
  }

  return {
    push(event) {
      if (closed) {
        return;
      }
      if (!shouldBufferEvent(event)) {
        if (pending.length === 0) {
          options.apply([event]);
          return;
        }
        const events = [...pending, event];
        pending = [];
        cancelTimer();
        options.apply(events);
        return;
      }
      pending.push(event);
      scheduleFlush();
    },
    flush,
    close() {
      closed = true;
      pending = [];
      cancelTimer();
    }
  };
}

// S4.1 只缓冲 LLM 正文 delta。非 delta 事件会立刻冲刷 pending，保证工具卡、
// complete、系统事件等不会被排在旧 delta 前面。
function shouldBufferEvent(event: RuntimeClientEvent): boolean {
  return event.kind === 'message.delta';
}
