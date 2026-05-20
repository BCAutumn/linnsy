import { afterEach, describe, expect, test, vi } from 'vitest';

import { createShutdownCoordinator } from '../../electron/shutdown.js';

describe('createShutdownCoordinator', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('runs handlers in registration order', async () => {
    const order: string[] = [];
    const shutdown = createShutdownCoordinator({ logger: createSilentLogger() });
    shutdown.register('first', () => {
      order.push('first');
    });
    shutdown.register('second', () => {
      order.push('second');
    });
    shutdown.register('third', () => {
      order.push('third');
    });

    await shutdown.run('test');

    expect(order).toEqual(['first', 'second', 'third']);
  });

  test('awaits async handlers before moving on', async () => {
    const order: string[] = [];
    const shutdown = createShutdownCoordinator({ logger: createSilentLogger() });
    shutdown.register('async-first', async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      order.push('async-first');
    });
    shutdown.register('sync-second', () => {
      order.push('sync-second');
    });

    await shutdown.run('test');

    expect(order).toEqual(['async-first', 'sync-second']);
  });

  test('continues running remaining handlers after one throws', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const order: string[] = [];
    const shutdown = createShutdownCoordinator({ logger });
    shutdown.register('boom', () => {
      throw new Error('handler exploded');
    });
    shutdown.register('after', () => {
      order.push('after');
    });

    await shutdown.run('test');

    expect(order).toEqual(['after']);
    const warnings = logger.warn.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(warnings.some((message: string) => message.includes("'boom'") && message.includes('handler exploded'))).toBe(true);
  });

  test('is idempotent: repeated run returns the same in-flight promise', async () => {
    let invocations = 0;
    const shutdown = createShutdownCoordinator({ logger: createSilentLogger() });
    shutdown.register('counted', async () => {
      invocations += 1;
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    });

    const first = shutdown.run('test');
    const second = shutdown.run('test-again');
    expect(shutdown.hasStarted()).toBe(true);
    await Promise.all([first, second]);

    expect(invocations).toBe(1);
  });

  test('timeout releases the caller even if a handler hangs', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    // 用对象包一层挂在闭包里给 handler 写入；TS control flow 不会把闭包内的赋值
    // 反推回外层，let + null 写法会在外层断言时被 narrow 成 never。
    const hang: { resolve: (() => void) | null } = { resolve: null };
    const shutdown = createShutdownCoordinator({ logger, timeoutMs: 20 });
    shutdown.register('hang', () => new Promise<void>((resolve) => {
      hang.resolve = resolve;
    }));

    const startedAt = Date.now();
    await shutdown.run('test');
    const elapsed = Date.now() - startedAt;

    expect(elapsed).toBeLessThan(200);
    const warnings = logger.warn.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(warnings.some((message: string) => message.includes('timeout'))).toBe(true);

    // 解除挂住的 handler，避免 vitest detect open handles 报警
    hang.resolve?.();
  });

  test('clears the timeout timer when shutdown finishes before the ceiling', async () => {
    vi.useFakeTimers();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const shutdown = createShutdownCoordinator({ logger, timeoutMs: 100 });
    shutdown.register('fast', () => undefined);

    await shutdown.run('test');
    await vi.advanceTimersByTimeAsync(100);

    const warnings = logger.warn.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(warnings.some((message: string) => message.includes('timeout'))).toBe(false);
  });


  test('hasStarted reports false before run and true afterwards', async () => {
    const shutdown = createShutdownCoordinator({ logger: createSilentLogger() });
    shutdown.register('noop', () => undefined);
    expect(shutdown.hasStarted()).toBe(false);
    await shutdown.run('test');
    expect(shutdown.hasStarted()).toBe(true);
  });
});

function createSilentLogger(): { info: () => void; warn: () => void; error: () => void } {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  };
}
