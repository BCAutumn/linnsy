import { randomUUID } from 'node:crypto';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../shared/errors.js';
import type {
  ChatType,
  LinnsyAttachment,
  LinnsyMessage,
  OutboundPayload,
  Platform,
  SendTarget
} from '../../../../shared/messaging.js';
import type { ClockPort, LoggerPort } from '../../../../shared/ports.js';
import { consoleLogger, systemClock } from '../../../../shared/ports.js';

import type {
  ChannelAdapterPort,
  ChannelHealth,
  ChannelSendResult,
  InboundHandler
} from '../../definitions/types.js';

export interface CliChannelAdapterOptions {
  stdin?: Readable;
  stdout?: Writable;
  clock?: ClockPort;
  logger?: LoggerPort;
  /** Used to generate inbound message ids; defaults to UUID v4. */
  messageIdFactory?: () => string;
  /** Default chat metadata used to wrap stdin lines into LinnsyMessage. */
  chatId?: string;
  chatType?: ChatType;
  userId?: string;
  /** Optional outbound prefix; defaults to '> ' so user can distinguish replies. */
  outboundPrefix?: string;
}

export const CLI_PLATFORM: Platform = 'cli';

export function createCliChannelAdapter(options: CliChannelAdapterOptions = {}): ChannelAdapterPort {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const clock = options.clock ?? systemClock;
  const logger = options.logger ?? consoleLogger;
  const messageIdFactory = options.messageIdFactory ?? defaultMessageIdFactory;
  const chatId = options.chatId ?? 'local';
  const chatType: ChatType = options.chatType ?? 'private';
  const outboundPrefix = options.outboundPrefix ?? '';
  const userId = options.userId;

  const state = {
    handler: null as InboundHandler | null,
    readline: null as ReadlineInterface | null,
    inFlight: new Set<Promise<void>>()
  };

  return {
    platform: CLI_PLATFORM,

    start(handler: InboundHandler): Promise<void> {
      if (state.handler !== null) {
        return Promise.reject(
          new LinnsyError(
            LINNSY_ERROR_CODES.CHANNEL_NOT_STARTED,
            'CLI channel adapter is already started; call stop() before start() again',
            false
          )
        );
      }
      state.handler = handler;

      const rl = createInterface({ input: stdin, crlfDelay: Infinity });
      state.readline = rl;

      rl.on('line', (line: string) => {
        const currentHandler = state.handler;
        if (currentHandler === null) {
          return;
        }
        const text = line.replace(/\r$/u, '');
        if (text.length === 0) {
          return;
        }

        const message: LinnsyMessage = {
          messageId: messageIdFactory(),
          platform: CLI_PLATFORM,
          chatType,
          chatId,
          ...(userId === undefined ? {} : { userId }),
          text,
          receivedAt: clock.now()
        };

        const work = Promise.resolve()
          .then(() => currentHandler(message))
          .catch((error: unknown) => {
            logger.error('cli-channel handler failed', {
              messageId: message.messageId,
              error: serializeError(error)
            });
          })
          .finally(() => {
            state.inFlight.delete(work);
        });
        state.inFlight.add(work);
      });
      return Promise.resolve();
    },

    async stop(): Promise<void> {
      if (state.handler === null) {
        return;
      }
      state.handler = null;
      if (state.readline !== null) {
        state.readline.removeAllListeners('line');
        state.readline.close();
        state.readline = null;
      }
      const pending = Array.from(state.inFlight);
      await Promise.allSettled(pending);
    },

    async send(target: SendTarget, payload: OutboundPayload): Promise<ChannelSendResult> {
      if (state.handler === null) {
        throw new LinnsyError(
          LINNSY_ERROR_CODES.CHANNEL_NOT_STARTED,
          'CLI channel adapter is not started; cannot send outbound payload',
          false
        );
      }
      if (target.platform !== CLI_PLATFORM) {
        logger.warn('cli-channel received non-cli send target; routing as cli anyway', {
          requestedPlatform: target.platform
        });
      }
      const lines = renderPayload(payload, outboundPrefix);
      for (const line of lines) {
        await writeLine(stdout, line);
      }
      return { delivery: 'sent', providerMessageId: defaultMessageIdFactory() };
    },

    healthcheck(): Promise<ChannelHealth> {
      if (state.handler === null) {
        return Promise.resolve({ ok: false, detail: 'channel not started' });
      }
      const stdoutWritable = stdout.writable;
      if (!stdoutWritable) {
        return Promise.resolve({ ok: false, detail: 'stdout is not writable' });
      }
      const stdinReadable = isStreamReadable(stdin);
      if (!stdinReadable) {
        return Promise.resolve({ ok: false, detail: 'stdin is not readable' });
      }
      return Promise.resolve({ ok: true });
    }
  };
}

function defaultMessageIdFactory(): string {
  return `cli_${randomUUID()}`;
}

function renderPayload(payload: OutboundPayload, prefix: string): string[] {
  const lines: string[] = [];
  if (payload.text !== undefined && payload.text.length > 0) {
    for (const segment of payload.text.split(/\r?\n/u)) {
      lines.push(`${prefix}${segment}`);
    }
  }
  if (payload.attachments !== undefined) {
    for (const attachment of payload.attachments) {
      lines.push(`${prefix}${renderAttachmentFallback(attachment)}`);
    }
  }
  if (lines.length === 0) {
    lines.push(prefix);
  }
  return lines;
}

function renderAttachmentFallback(attachment: LinnsyAttachment): string {
  const filename = attachment.filename ?? attachment.uri;
  return `[attachment:${attachment.kind}] ${filename}`;
}

function writeLine(stream: Writable, line: string): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(`${line}\n`, (error?: Error | null) => {
      if (error !== null && error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function isStreamReadable(stream: Readable): boolean {
  if (!stream.readable) {
    return false;
  }
  if ('destroyed' in stream && stream.destroyed) {
    return false;
  }
  return true;
}

function serializeError(error: unknown): { message: string; stack?: string; code?: string } {
  if (error instanceof Error) {
    const result: { message: string; stack?: string; code?: string } = { message: error.message };
    if (error.stack !== undefined) {
      result.stack = error.stack;
    }
    if (error instanceof LinnsyError) {
      result.code = error.code;
    }
    return result;
  }
  return { message: String(error) };
}
