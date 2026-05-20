import { serve, type ServerType } from '@hono/node-server';

import { createWechatGatewayApp, type CreateWechatGatewayAppOptions } from './hono-app.js';

export interface WechatGatewayRunnerPort {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface CreateWechatGatewayRunnerOptions extends CreateWechatGatewayAppOptions {
  bind: string;
  serve?: ServeFunction;
}

export type ServeFunction = (
  options: { fetch: (request: Request) => Promise<Response> | Response; hostname: string; port: number }
) => CloseableServer;

export interface CloseableServer {
  readonly listening?: boolean;
  close(callback?: () => void): void;
  once?(event: 'listening', listener: () => void): this;
  once?(event: 'error', listener: (error: Error) => void): this;
  off?(event: 'listening', listener: () => void): this;
  off?(event: 'error', listener: (error: Error) => void): this;
}

export function createWechatGatewayRunner(
  options: CreateWechatGatewayRunnerOptions
): WechatGatewayRunnerPort {
  const app = createWechatGatewayApp(options);
  const parsed = parseBind(options.bind);
  const serveFn = options.serve ?? defaultServe;
  let server: CloseableServer | null = null;

  return {
    async start(): Promise<void> {
      if (server !== null) {
        return;
      }

      const active = serveFn({
        fetch: app.fetch,
        hostname: parsed.hostname,
        port: parsed.port
      });
      server = active;
      try {
        await waitForServerListening(active);
      } catch (error: unknown) {
        if (server === active) {
          server = null;
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`failed to start wechat gateway on ${parsed.hostname}:${parsed.port.toString()}: ${message}`);
      }
    },

    stop(): Promise<void> {
      if (server === null) {
        return Promise.resolve();
      }

      const active = server;
      server = null;
      return new Promise((resolve) => {
        active.close(resolve);
      });
    }
  };
}

function waitForServerListening(server: CloseableServer): Promise<void> {
  if (server.listening === true || server.once === undefined || server.off === undefined) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      server.off?.('listening', onListening);
      server.off?.('error', onError);
    };
    const onListening = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    server.once?.('listening', onListening);
    server.once?.('error', onError);
  });
}

function defaultServe(
  options: { fetch: (request: Request) => Promise<Response> | Response; hostname: string; port: number }
): ServerType {
  return serve(options);
}

function parseBind(bind: string): { hostname: string; port: number } {
  const separatorIndex = bind.lastIndexOf(':');
  if (separatorIndex === -1) {
    throw new Error(`invalid wechat gateway bind ${bind}`);
  }

  const hostname = bind.slice(0, separatorIndex);
  const portText = bind.slice(separatorIndex + 1);
  const port = Number(portText);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`invalid wechat gateway port ${portText}`);
  }

  return { hostname, port };
}
