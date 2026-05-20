import type { WechatGatewayConnectionState } from '../../../src/domains/channel/features/wechat/gateway/types.js';

export interface WechatGatewayStatusClientConfig {
  baseUrl: string;
  bearerToken: string;
  fetchImpl?: typeof fetch;
}

export interface WechatGatewayStatusClient {
  readSnapshot(): Promise<WechatGatewaySnapshot>;
  deleteAccount(): Promise<WechatGatewaySnapshot>;
  requestFreshQrLogin(): Promise<WechatGatewaySnapshot>;
}

export class WechatGatewayStatusHttpError extends Error {
  readonly status: number;
  readonly statusText: string;

  constructor(status: number, statusText: string) {
    super(`wechat gateway status failed: ${status.toString()} ${statusText}`);
    this.name = 'WechatGatewayStatusHttpError';
    this.status = status;
    this.statusText = statusText;
  }
}

export function isWechatGatewayStatusHttpError(error: unknown): error is WechatGatewayStatusHttpError {
  return error instanceof WechatGatewayStatusHttpError;
}

export interface WechatGatewaySnapshot {
  ok: boolean;
  account: {
    accountId: string;
    baseUrl: string;
    connectedAt: number;
    source: string;
    userId?: string;
  } | null;
  connection: {
    state: WechatGatewayConnectionState;
    startedAt?: number;
    qrLoginUrl?: string;
    qrLoginIssuedAt?: number;
    qrLoginExpiresAt?: number;
    lastPollSucceededAt?: number;
    lastPollErrorAt?: number;
    lastPollError?: string;
  };
  outbound: {
    deferredReadyCount: number;
    deferredClaimedCount: number;
  };
}

export function createWechatGatewayStatusClient(
  config: WechatGatewayStatusClientConfig
): WechatGatewayStatusClient {
  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    async readSnapshot(): Promise<WechatGatewaySnapshot> {
      const response = await fetchImpl(new URL('/v1/status', config.baseUrl), {
        headers: {
          authorization: `Bearer ${config.bearerToken}`
        }
      });

      return parseWechatGatewaySnapshot(await readJsonResponse(response));
    },

    async deleteAccount(): Promise<WechatGatewaySnapshot> {
      const response = await fetchImpl(new URL('/v1/account', config.baseUrl), {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${config.bearerToken}`
        }
      });

      return parseWechatGatewaySnapshot(await readJsonResponse(response));
    },

    async requestFreshQrLogin(): Promise<WechatGatewaySnapshot> {
      const response = await fetchImpl(new URL('/v1/qr-login/show', config.baseUrl), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.bearerToken}`
        }
      });

      return parseWechatGatewaySnapshot(await readJsonResponse(response));
    }
  };
}

async function readJsonResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new WechatGatewayStatusHttpError(response.status, response.statusText);
  }
  return response.json() as Promise<unknown>;
}

export function parseWechatGatewaySnapshot(payload: unknown): WechatGatewaySnapshot {
  if (!isRecord(payload) || !isRecord(payload.connection) || !isRecord(payload.outbound)) {
    throw new Error('invalid wechat gateway status payload');
  }
  const state = payload.connection.state;
  if (!isWechatGatewayConnectionState(state)) {
    throw new Error('invalid wechat gateway connection state');
  }
  const account = parseAccount(payload.account);
  return {
    ok: payload.ok === true,
    account,
    connection: {
      state,
      ...readOptionalNumberField(payload.connection, 'startedAt'),
      ...readOptionalStringField(payload.connection, 'qrLoginUrl'),
      ...readOptionalNumberField(payload.connection, 'qrLoginIssuedAt'),
      ...readOptionalNumberField(payload.connection, 'qrLoginExpiresAt'),
      ...readOptionalNumberField(payload.connection, 'lastPollSucceededAt'),
      ...readOptionalNumberField(payload.connection, 'lastPollErrorAt'),
      ...readOptionalStringField(payload.connection, 'lastPollError')
    },
    outbound: {
      deferredReadyCount: readRequiredNumber(payload.outbound.deferredReadyCount, 'deferredReadyCount'),
      deferredClaimedCount: readRequiredNumber(payload.outbound.deferredClaimedCount, 'deferredClaimedCount')
    }
  };
}

function parseAccount(value: unknown): WechatGatewaySnapshot['account'] {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    throw new Error('invalid wechat gateway account payload');
  }
  return {
    accountId: readRequiredString(value.accountId, 'accountId'),
    baseUrl: readRequiredString(value.baseUrl, 'baseUrl'),
    connectedAt: readRequiredNumber(value.connectedAt, 'connectedAt'),
    source: readRequiredString(value.source, 'source'),
    ...readOptionalStringField(value, 'userId')
  };
}

function isWechatGatewayConnectionState(value: unknown): value is WechatGatewayConnectionState {
  return value === 'not_connected'
    || value === 'starting'
    || value === 'awaiting_qr_scan'
    || value === 'connected'
    || value === 'degraded';
}

function readRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`invalid wechat gateway ${fieldName}`);
  }
  return value;
}

function readRequiredNumber(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`invalid wechat gateway ${fieldName}`);
  }
  return value;
}

function readOptionalStringField(source: Record<string, unknown>, fieldName: string): Record<string, string> {
  const value = source[fieldName];
  if (value === undefined) {
    return {};
  }
  if (typeof value !== 'string') {
    throw new Error(`invalid wechat gateway ${fieldName}`);
  }
  return { [fieldName]: value };
}

function readOptionalNumberField(source: Record<string, unknown>, fieldName: string): Record<string, number> {
  const value = source[fieldName];
  if (value === undefined) {
    return {};
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`invalid wechat gateway ${fieldName}`);
  }
  return { [fieldName]: value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
