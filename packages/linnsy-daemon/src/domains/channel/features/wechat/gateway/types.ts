export type WechatDeliveryMode = 'reply' | 'proactive';

export interface WechatGatewayStateStoreOptions {
  stateDir: string;
}

export interface ContextTokenRecord {
  chatId: string;
  token: string;
}

export interface WechatGatewayAccount {
  accountId: string;
  botToken: string;
  baseUrl: string;
  connectedAt: number;
  userId?: string;
}

export type WechatGatewayConnectionSource = 'manual_env' | 'saved_account' | 'fresh_qr';
export type WechatGatewayConnectionState =
  | 'not_connected'
  | 'starting'
  | 'awaiting_qr_scan'
  | 'connected'
  | 'degraded';

export interface WechatGatewayStatus {
  ok: boolean;
  account: {
    accountId: string;
    baseUrl: string;
    connectedAt: number;
    source: WechatGatewayConnectionSource;
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

export interface WechatGatewayStatusPort {
  recordGatewayStarting(at: number): void;
  recordQrIssued(at: number, qrUrl: string, expiresAt: number): void;
  recordQrExpired(at: number): void;
  recordQrCleared(at: number): void;
  recordAccountConnected(at: number, account: WechatGatewayAccount, source: WechatGatewayConnectionSource): void;
  recordAccountCleared(at: number): void;
  recordPollSuccess(at: number): void;
  recordPollFailure(at: number, error: string): void;
  snapshot(): Promise<WechatGatewayStatus>;
}

export interface ContextTokenStorePort {
  save(input: ContextTokenRecord): Promise<void>;
  get(chatId: string): Promise<ContextTokenRecord | null>;
  clear(): Promise<void>;
}

export interface WechatAccountStorePort {
  save(input: WechatGatewayAccount): Promise<void>;
  get(): Promise<WechatGatewayAccount | null>;
  clear(): Promise<void>;
}

export interface DeferredOutboundMessage {
  deferredId: string;
  chatId: string;
  text: string;
  deliveryMode: WechatDeliveryMode;
  createdAt: number;
}

export type DeferredOutboundStatus = 'ready' | 'claimed';

export interface DeferredOutboundPersistedRecord extends DeferredOutboundMessage {
  status: DeferredOutboundStatus;
}

export interface OutboundQueuePort {
  enqueue(input: DeferredOutboundMessage): Promise<void>;
  claimReadyForChat(chatId: string): Promise<DeferredOutboundMessage[]>;
  markDelivered(deferredIds: string[]): Promise<void>;
  releaseClaimed(deferredIds: string[]): Promise<void>;
  getSummary(): Promise<{ readyCount: number; claimedCount: number }>;
  clear(): Promise<void>;
}
