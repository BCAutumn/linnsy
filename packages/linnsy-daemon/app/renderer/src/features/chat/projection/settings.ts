// projection 运行时设置。
// 注意：这些设置只控制"事件进入 reducer 前"的调度方式，不改变 reducer 的纯函数语义。

const defaultFlushIntervalMs = 33;
let flushIntervalMs = defaultFlushIntervalMs;

export function getFlushIntervalMs(): number {
  return flushIntervalMs;
}

export function setFlushIntervalMs(ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError('flush interval must be a non-negative finite number');
  }
  flushIntervalMs = ms;
}

export function resetFlushIntervalMs(): void {
  flushIntervalMs = defaultFlushIntervalMs;
}
