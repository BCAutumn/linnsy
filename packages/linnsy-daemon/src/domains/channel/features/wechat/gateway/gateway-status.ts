import type {
  OutboundQueuePort,
  WechatGatewayAccount,
  WechatGatewayConnectionSource,
  WechatGatewayConnectionState,
  WechatGatewayStatus,
  WechatGatewayStatusPort
} from './types.js';

export interface CreateWechatGatewayStatusTrackerOptions {
  account?: WechatGatewayAccount;
  connectionSource?: WechatGatewayConnectionSource;
  queue: Pick<OutboundQueuePort, 'getSummary'>;
}

interface RuntimePollState {
  startedAt?: number;
  lastPollSucceededAt?: number;
  lastPollErrorAt?: number;
  lastPollError?: string;
}

interface RuntimeQrState {
  qrUrl: string;
  issuedAt: number;
  expiresAt: number;
}

interface RuntimeAccountState {
  account: WechatGatewayAccount;
  source: WechatGatewayConnectionSource;
  connectedAt: number;
}

export function createWechatGatewayStatusTracker(
  options: CreateWechatGatewayStatusTrackerOptions
): WechatGatewayStatusPort {
  const pollState: RuntimePollState = {};
  let accountState: RuntimeAccountState | null = options.account === undefined
    ? null
    : {
      account: options.account,
      source: options.connectionSource ?? 'saved_account',
      connectedAt: options.account.connectedAt
    };
  let qrState: RuntimeQrState | null = null;

  return {
    recordGatewayStarting(at: number): void {
      pollState.startedAt = at;
    },

    recordQrIssued(at: number, qrUrl: string, expiresAt: number): void {
      qrState = { qrUrl, issuedAt: at, expiresAt };
      delete pollState.lastPollErrorAt;
      delete pollState.lastPollError;
    },

    recordQrExpired(): void {
      qrState = null;
    },

    recordQrCleared(): void {
      qrState = null;
    },

    recordAccountConnected(at: number, account: WechatGatewayAccount, source: WechatGatewayConnectionSource): void {
      accountState = {
        account,
        source,
        connectedAt: at
      };
      qrState = null;
      delete pollState.lastPollErrorAt;
      delete pollState.lastPollError;
    },

    recordAccountCleared(at: number): void {
      accountState = null;
      qrState = null;
      pollState.startedAt = at;
      delete pollState.lastPollSucceededAt;
      delete pollState.lastPollErrorAt;
      delete pollState.lastPollError;
    },

    recordPollSuccess(at: number): void {
      pollState.lastPollSucceededAt = at;
      delete pollState.lastPollErrorAt;
      delete pollState.lastPollError;
    },

    recordPollFailure(at: number, error: string): void {
      pollState.lastPollErrorAt = at;
      pollState.lastPollError = error;
    },

    async snapshot(): Promise<WechatGatewayStatus> {
      const outbound = await options.queue.getSummary();
      const state = deriveConnectionState(accountState, qrState, pollState);

      return {
        ok: state === 'starting' || state === 'awaiting_qr_scan' || state === 'connected',
        account: accountState === null
          ? null
          : {
            accountId: accountState.account.accountId,
            ...(accountState.account.userId === undefined ? {} : { userId: accountState.account.userId }),
            baseUrl: accountState.account.baseUrl,
            connectedAt: accountState.account.connectedAt,
            source: accountState.source
          },
        connection: {
          state,
          ...(pollState.startedAt === undefined
            ? {}
            : { startedAt: pollState.startedAt }),
          ...(qrState === null
            ? {}
            : {
              qrLoginUrl: qrState.qrUrl,
              qrLoginIssuedAt: qrState.issuedAt,
              qrLoginExpiresAt: qrState.expiresAt
            }),
          ...(pollState.lastPollSucceededAt === undefined
            ? {}
            : { lastPollSucceededAt: pollState.lastPollSucceededAt }),
          ...(pollState.lastPollErrorAt === undefined
            ? {}
            : { lastPollErrorAt: pollState.lastPollErrorAt }),
          ...(pollState.lastPollError === undefined
            ? {}
            : { lastPollError: pollState.lastPollError })
        },
        outbound: {
          deferredReadyCount: outbound.readyCount,
          deferredClaimedCount: outbound.claimedCount
        }
      };
    }
  };
}

function deriveConnectionState(
  accountState: RuntimeAccountState | null,
  qrState: RuntimeQrState | null,
  pollState: RuntimePollState
): WechatGatewayConnectionState {
  if (qrState !== null) {
    return 'awaiting_qr_scan';
  }
  if (accountState === null) {
    return 'not_connected';
  }
  if (pollState.lastPollErrorAt !== undefined) {
    return 'degraded';
  }
  if (pollState.lastPollSucceededAt !== undefined) {
    return 'connected';
  }
  return 'connected';
}
