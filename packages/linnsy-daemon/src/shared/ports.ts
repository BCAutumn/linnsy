export interface ClockPort {
  now(): number;
}

export interface LoggerPort {
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

export const systemClock: ClockPort = {
  now(): number {
    return Date.now();
  }
};

export const consoleLogger: LoggerPort = {
  info(message, metadata) {
    logWithMetadata(console.log, message, metadata);
  },
  warn(message, metadata) {
    logWithMetadata(console.warn, message, metadata);
  },
  error(message, metadata) {
    logWithMetadata(console.error, message, metadata);
  }
};

export const silentLogger: LoggerPort = {
  info() {
    // intentionally silent
  },
  warn() {
    // intentionally silent
  },
  error() {
    // intentionally silent
  }
};

function logWithMetadata(
  output: (message?: unknown, ...optionalParams: unknown[]) => void,
  message: string,
  metadata: Record<string, unknown> | undefined
): void {
  if (metadata === undefined) {
    output(message);
    return;
  }

  output(message, metadata);
}
