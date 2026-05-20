import { describe, expect, test } from 'vitest';

import { ChannelDesktopRegistry } from '../../electron/channels/channel-desktop-registry.js';
import type {
  ChannelDesktopController,
  ChannelDesktopStatus,
  ChannelDesktopStatusListener
} from '../../electron/channels/types.js';

describe('ChannelDesktopRegistry', () => {
  test('forwards status changes from controllers registered after subscribeAll', () => {
    const registry = new ChannelDesktopRegistry();
    const pushed: ChannelDesktopStatus[] = [];
    const unsubscribe = registry.subscribeAll((status) => {
      pushed.push(status);
    });
    const wechat = createFakeController('wechat');
    const telegram = createFakeController('telegram');

    registry.register(wechat.controller);
    wechat.emit(createStatus('wechat', 'starting'));
    registry.register(telegram.controller);
    telegram.emit(createStatus('telegram', 'awaiting_login'));
    unsubscribe();
    wechat.emit(createStatus('wechat', 'connected'));

    expect(pushed).toEqual([
      createStatus('wechat', 'starting'),
      createStatus('telegram', 'awaiting_login')
    ]);
  });
});

function createFakeController(channelId: string): {
  controller: ChannelDesktopController;
  emit(status: ChannelDesktopStatus): void;
} {
  const listeners = new Set<ChannelDesktopStatusListener>();
  const idleStatus = createStatus(channelId, 'idle');
  return {
    controller: {
      channelId,
      start: () => Promise.resolve(idleStatus),
      stop: () => Promise.resolve(idleStatus),
      reconnectNetwork: () => Promise.resolve(idleStatus),
      deleteAccount: () => Promise.resolve(idleStatus),
      requestQrCode: () => Promise.resolve(idleStatus),
      setAutoConnect: () => Promise.resolve(idleStatus),
      getStatus: () => Promise.resolve(idleStatus),
      subscribe(listener): () => void {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      dispose: () => Promise.resolve()
    },
    emit(status): void {
      for (const listener of listeners) {
        listener(status);
      }
    }
  };
}

function createStatus(
  channelId: string,
  lifecycle: ChannelDesktopStatus['lifecycle']
): ChannelDesktopStatus {
  return {
    channelId,
    lifecycle,
    autoConnect: false
  };
}
