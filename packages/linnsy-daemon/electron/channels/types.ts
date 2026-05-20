import type {
  ChannelDesktopAction,
  ChannelDesktopStatus
} from '../../src/domains/desktop-integration/definitions/desktop-channel-contract.js';

export type { ChannelDesktopAction, ChannelDesktopStatus };

export type ChannelDesktopStatusListener = (status: ChannelDesktopStatus) => void;

export interface ChannelDesktopController {
  readonly channelId: string;
  start(): Promise<ChannelDesktopStatus>;
  stop(): Promise<ChannelDesktopStatus>;
  reconnectNetwork(): Promise<ChannelDesktopStatus>;
  deleteAccount(): Promise<ChannelDesktopStatus>;
  requestQrCode(): Promise<ChannelDesktopStatus>;
  setAutoConnect(enabled: boolean): Promise<ChannelDesktopStatus>;
  getStatus(): Promise<ChannelDesktopStatus>;
  subscribe(listener: ChannelDesktopStatusListener): () => void;
  dispose(): Promise<void>;
}
