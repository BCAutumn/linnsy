import type {
  LinnsyMessage,
  OutboundPayload,
  Platform,
  SendTarget
} from '../../../shared/messaging.js';

export type InboundHandler = (message: LinnsyMessage) => Promise<void>;

export interface ChannelHealth {
  ok: boolean;
  detail?: string;
}

export type ChannelDelivery = 'sent' | 'deferred' | 'failed';

export interface ChannelSendResult {
  delivery: ChannelDelivery;
  providerMessageId?: string;
  detail?: string;
}

export interface ChannelAdapterPort {
  readonly platform: Platform;
  start(handler: InboundHandler): Promise<void>;
  stop(): Promise<void>;
  send(target: SendTarget, payload: OutboundPayload): Promise<ChannelSendResult>;
  healthcheck(): Promise<ChannelHealth>;
}
