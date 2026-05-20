import { loadLinnsyConfig } from '../config/loader.js';
import { applyDesktopRuntimeOverrides } from '../config/desktop-overrides.js';
import { createLocalDaemonStack } from '../app/bootstrap/local-daemon-stack.js';
import { consoleLogger, silentLogger, type LoggerPort } from '../shared/ports.js';
import type { CliCommand } from './types.js';

interface ChatCommandOptions {
  audit: boolean;
}

export function createChatCommand(options: ChatCommandOptions): CliCommand {
  return {
    name: options.audit ? 'chat:audit' : 'chat',
    description: options.audit
      ? 'Start an interactive Linnsy CLI chat session with runtime audit logs'
      : 'Start an interactive Linnsy CLI chat session',
    register(command) {
      command.action(async () => {
        await runChatCommand(options);
      });
    }
  };
}

async function runChatCommand(options: ChatCommandOptions): Promise<void> {
  return options.audit
    ? runChatCommandWithConsoleMode(options)
    : withQuietConsole(() => runChatCommandWithConsoleMode(options));
}

async function runChatCommandWithConsoleMode(options: ChatCommandOptions): Promise<void> {
  const config = applyDesktopRuntimeOverrides(await loadLinnsyConfig());
  const logger = selectChatLogger(options);
  const stack = createLocalDaemonStack({
    config,
    logger,
    cliOutboundPrefix: '> '
  });

  await stack.start();
  try {
    await waitForStdinCloseOrInterrupt();
  } finally {
    await stack.stop();
    stack.dispose();
  }
}

function selectChatLogger(options: ChatCommandOptions): LoggerPort {
  return options.audit ? consoleLogger : silentLogger;
}

async function withQuietConsole<T>(operation: () => Promise<T>): Promise<T> {
  const original = {
    debug: console.debug,
    info: console.info,
    log: console.log
  };

  console.debug = noopConsole;
  console.info = noopConsole;
  console.log = noopConsole;
  try {
    return await operation();
  } finally {
    console.debug = original.debug;
    console.info = original.info;
    console.log = original.log;
  }
}

function noopConsole(): void {
  // Dialogue output is written through the CLI channel's stdout stream.
}

function waitForStdinCloseOrInterrupt(): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      process.stdin.off('end', finish);
      process.stdin.off('close', finish);
      process.off('SIGINT', finish);
      process.off('SIGTERM', finish);
      resolve();
    };
    process.stdin.once('end', finish);
    process.stdin.once('close', finish);
    process.once('SIGINT', finish);
    process.once('SIGTERM', finish);
  });
}
