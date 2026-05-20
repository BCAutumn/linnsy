export type ShutdownHandler = (reason: string) => Promise<void> | void;

export interface ShutdownCoordinator {
  register(name: string, handler: ShutdownHandler): void;
  run(reason: string): Promise<void>;
  hasStarted(): boolean;
}

export interface CreateShutdownCoordinatorOptions {
  timeoutMs?: number;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

// Electron 的 quit 路径很多（cmd+Q / dock / ⏻ / IPC / 信号），为了让"所有路径都把
// sidecar 带走"，bootstrap 期间把每个 sidecar 注册成一个 named handler，触发任意
// 路径都跑同一个 coordinator。run() 是 idempotent，重复触发只跑一次；总时长被
// timeoutMs 夹紧，避免某个 handler hang 住把退出卡死，过期就放手让 caller 兜底。
export function createShutdownCoordinator(
  options: CreateShutdownCoordinatorOptions = {}
): ShutdownCoordinator {
  const handlers: Array<{ name: string; handler: ShutdownHandler }> = [];
  const logger = options.logger ?? console;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  let runPromise: Promise<void> | null = null;

  return {
    register(name: string, handler: ShutdownHandler): void {
      handlers.push({ name, handler });
    },

    run(reason: string): Promise<void> {
      if (runPromise !== null) {
        return runPromise;
      }

      const startedAt = now();
      logger.info(`[linnsy electron] shutdown started: ${reason}`);

      const work = runAll(reason, handlers, logger, now);
      const guarded = runWithTimeout({
        work,
        timeoutMs,
        onTimeout: () => {
          logger.warn(`[linnsy electron] shutdown hit ${timeoutMs.toString()}ms timeout for reason '${reason}', proceeding anyway`);
        }
      }).then(() => {
        logger.info(`[linnsy electron] shutdown finished in ${(now() - startedAt).toString()}ms`);
      });

      runPromise = guarded;
      return guarded;
    },

    hasStarted(): boolean {
      return runPromise !== null;
    }
  };
}

async function runAll(
  reason: string,
  handlers: ReadonlyArray<{ name: string; handler: ShutdownHandler }>,
  logger: Pick<Console, 'info' | 'warn' | 'error'>,
  now: () => number
): Promise<void> {
  for (const { name, handler } of handlers) {
    const startedAt = now();
    try {
      await handler(reason);
      logger.info(`[linnsy electron] shutdown handler '${name}' done in ${(now() - startedAt).toString()}ms`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[linnsy electron] shutdown handler '${name}' failed after ${(now() - startedAt).toString()}ms: ${message}`);
    }
  }
}

async function runWithTimeout(input: {
  work: Promise<void>;
  timeoutMs: number;
  onTimeout(): void;
}): Promise<void> {
  let resolveTimeout: () => void = () => {};
  const timeout = new Promise<void>((resolve) => {
    resolveTimeout = resolve;
  });
  const timeoutId = setTimeout(() => {
    input.onTimeout();
    resolveTimeout();
  }, input.timeoutMs);

  await Promise.race([input.work, timeout]);
  clearTimeout(timeoutId);
}
