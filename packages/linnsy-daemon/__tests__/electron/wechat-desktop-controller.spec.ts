import { afterEach, describe, expect, test, vi } from 'vitest';

import { createWechatDesktopController } from '../../electron/channels/wechat/wechat-desktop-controller.js';
import {
  WechatGatewayStatusHttpError,
  type WechatGatewaySnapshot,
  type WechatGatewayStatusClient
} from '../../electron/channels/wechat/wechat-gateway-status-client.js';
import type { DaemonSpawner } from '../../electron/daemon-spawner.js';
import type { DesktopPreferences, DesktopPreferencesStore } from '../../electron/desktop-preferences.js';
import type { ChannelDesktopStatus } from '../../src/domains/desktop-integration/definitions/desktop-channel-contract.js';

describe('createWechatDesktopController', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('start emits starting before the QR login status arrives', async () => {
    const spawner = createFakeSpawner();
    const controller = createWechatDesktopController({
      spawner,
      statusClient: createStatusClient([
        new Error('gateway unavailable before spawn'),
        createSnapshot('awaiting_qr_scan', 'https://example.com/wechat-qr')
      ]),
      desktopPreferences: createPreferencesStore(),
      setDaemonWechatEnabled: vi.fn(() => Promise.resolve()),
      pollIntervalMs: 60_000,
      logger: { warn: vi.fn() }
    });
    const pushed: ChannelDesktopStatus[] = [];
    controller.subscribe((status) => {
      pushed.push(status);
    });

    const status = await controller.start();

    expect(spawner.startCalls).toEqual([{ env: undefined, args: [] }]);
    expect(pushed.map((item) => item.lifecycle)).toEqual(['starting', 'awaiting_login']);
    expect(status.lifecycle).toBe('awaiting_login');
  });

  test('start reuses an already running gateway instead of spawning a duplicate sidecar', async () => {
    const spawner = createFakeSpawner();
    const setDaemonWechatEnabled = vi.fn(() => Promise.resolve());
    const controller = createWechatDesktopController({
      spawner,
      statusClient: createStatusClient([
        createSnapshot('connected')
      ]),
      desktopPreferences: createPreferencesStore(),
      setDaemonWechatEnabled,
      pollIntervalMs: 60_000,
      logger: { warn: vi.fn() }
    });

    const status = await controller.start();

    expect(spawner.startCalls).toEqual([]);
    expect(setDaemonWechatEnabled).toHaveBeenCalledWith(true);
    expect(status).toEqual({
      channelId: 'wechat',
      lifecycle: 'connected',
      autoConnect: false
    });
  });

  test('start does not spawn a duplicate sidecar when an existing gateway rejects the bearer token', async () => {
    const spawner = createFakeSpawner();
    const setDaemonWechatEnabled = vi.fn(() => Promise.resolve());
    const controller = createWechatDesktopController({
      spawner,
      statusClient: createStatusClient([
        new WechatGatewayStatusHttpError(401, 'Unauthorized')
      ]),
      desktopPreferences: createPreferencesStore(),
      setDaemonWechatEnabled,
      pollIntervalMs: 60_000,
      logger: { warn: vi.fn() }
    });

    const status = await controller.start();

    expect(spawner.startCalls).toEqual([]);
    expect(setDaemonWechatEnabled).not.toHaveBeenCalled();
    expect(status).toEqual({
      channelId: 'wechat',
      lifecycle: 'degraded',
      autoConnect: false,
      detail: 'A WeChat gateway is already listening, but it rejected the desktop bearer token. Check LINNSY_WECHAT_GATEWAY_BEARER.'
    });
  });

  test('keeps starting while the gateway status endpoint has never responded', async () => {
    vi.useFakeTimers();
    const controller = createWechatDesktopController({
      spawner: createFakeSpawner(),
      statusClient: createStatusClient([]),
      desktopPreferences: createPreferencesStore(),
      setDaemonWechatEnabled: vi.fn(() => Promise.resolve()),
      pollIntervalMs: 10,
      logger: { warn: vi.fn() }
    });
    const pushed: ChannelDesktopStatus[] = [];
    controller.subscribe((status) => {
      pushed.push(status);
    });

    const status = await controller.start();
    await vi.advanceTimersByTimeAsync(10);

    expect(status.lifecycle).toBe('starting');
    expect(pushed.map((item) => item.lifecycle)).not.toContain('degraded');
    await controller.dispose();
  });

  test('deleteAccount clears account data without creating a QR code', async () => {
    const spawner = createFakeSpawner();
    const statusClient = createStatusClient([
      createSnapshot('not_connected', undefined, 100)
    ]);
    const pushed: ChannelDesktopStatus[] = [];
    const controller = createWechatDesktopController({
      spawner,
      statusClient,
      desktopPreferences: createPreferencesStore(),
      setDaemonWechatEnabled: vi.fn(() => Promise.resolve()),
      pollIntervalMs: 60_000,
      logger: { warn: vi.fn() }
    });
    controller.subscribe((status) => {
      pushed.push(status);
    });

    spawner.start();

    const status = await controller.deleteAccount();

    expect(spawner.stopCalls).toBe(0);
    expect(spawner.startCalls).toEqual([{ env: undefined, args: [] }]);
    expect(pushed.map((item) => item.lifecycle)).toEqual(['starting', 'awaiting_login']);
    expect(status).toEqual({
      channelId: 'wechat',
      lifecycle: 'awaiting_login',
      autoConnect: false
    });
  });

  test('requestQrCode asks the gateway for a fresh QR login and exposes its expiry', async () => {
    const spawner = createFakeSpawner();
    spawner.start();
    const controller = createWechatDesktopController({
      spawner,
      statusClient: createStatusClient([
        createSnapshot('awaiting_qr_scan', 'https://example.com/wechat-qr', 100, 320)
      ]),
      desktopPreferences: createPreferencesStore(),
      setDaemonWechatEnabled: vi.fn(() => Promise.resolve()),
      pollIntervalMs: 60_000,
      logger: { warn: vi.fn() }
    });
    const pushed: ChannelDesktopStatus[] = [];
    controller.subscribe((status) => {
      pushed.push(status);
    });

    const status = await controller.requestQrCode();

    expect(status).toEqual({
      channelId: 'wechat',
      lifecycle: 'awaiting_login',
      autoConnect: false,
      loginHint: {
        kind: 'qr',
        url: 'https://example.com/wechat-qr',
        expiresAt: 320
      }
    });
    expect(pushed.map((item) => item.lifecycle)).toEqual(['awaiting_login', 'awaiting_login']);
    expect(pushed.map((item) => item.lifecycle)).not.toContain('starting');
  });

  test('deleteAccount ignores stale connected snapshots during the operation window', async () => {
    vi.useFakeTimers();
    const spawner = createFakeSpawner();
    spawner.start();
    const controller = createWechatDesktopController({
      spawner,
      statusClient: createStatusClient([
        createSnapshot('awaiting_qr_scan', 'https://example.com/wechat-qr'),
        createSnapshot('connected')
      ]),
      desktopPreferences: createPreferencesStore(),
      setDaemonWechatEnabled: vi.fn(() => Promise.resolve()),
      pollIntervalMs: 10,
      logger: { warn: vi.fn() }
    });
    const pushed: ChannelDesktopStatus[] = [];
    controller.subscribe((status) => {
      pushed.push(status);
    });

    await controller.deleteAccount();
    await vi.advanceTimersByTimeAsync(10);

    expect(pushed.map((item) => item.lifecycle)).toEqual(['starting', 'awaiting_login']);
    await controller.dispose();
  });

  test('deleteAccount keeps degraded visible when a stale connected snapshot arrives after failure', async () => {
    vi.useFakeTimers();
    const spawner = createFakeSpawner();
    spawner.start();
    const controller = createWechatDesktopController({
      spawner,
      statusClient: createStatusClient([
        new Error('delete account failed'),
        createSnapshot('connected')
      ]),
      desktopPreferences: createPreferencesStore(),
      setDaemonWechatEnabled: vi.fn(() => Promise.resolve()),
      pollIntervalMs: 10,
      logger: { warn: vi.fn() }
    });
    const pushed: ChannelDesktopStatus[] = [];
    controller.subscribe((status) => {
      pushed.push(status);
    });

    await controller.deleteAccount();
    await vi.advanceTimersByTimeAsync(10);

    expect(pushed.map((item) => item.lifecycle)).toEqual(['starting', 'degraded']);
    await controller.dispose();
  });

  test('reconnectNetwork restarts the spawned sidecar without clearing account data', async () => {
    const spawner = createFakeSpawner();
    spawner.start();
    const controller = createWechatDesktopController({
      spawner,
      statusClient: createStatusClient([
        new Error('gateway unavailable before restart'),
        createSnapshot('connected')
      ]),
      desktopPreferences: createPreferencesStore(),
      setDaemonWechatEnabled: vi.fn(() => Promise.resolve()),
      pollIntervalMs: 60_000,
      logger: { warn: vi.fn() }
    });

    const status = await controller.reconnectNetwork();

    expect(spawner.stopCalls).toBe(1);
    expect(spawner.startCalls).toEqual([
      { env: undefined, args: [] },
      { env: undefined, args: [] }
    ]);
    expect(status.lifecycle).toBe('connected');
  });

  test('reconnectNetwork ignores connected snapshots observed while the old sidecar is still stopping', async () => {
    vi.useFakeTimers();
    const stopControl: { resolve: (() => void) | null } = { resolve: null };
    const spawner = createFakeSpawner({
      stopDelay: () => new Promise<void>((resolve) => {
        stopControl.resolve = resolve;
      })
    });
    spawner.start();
    const controller = createWechatDesktopController({
      spawner,
      statusClient: createStatusClient([
        createSnapshot('connected'),
        createSnapshot('connected'),
        new Error('gateway unavailable after stop'),
        createSnapshot('connected')
      ]),
      desktopPreferences: createPreferencesStore(),
      setDaemonWechatEnabled: vi.fn(() => Promise.resolve()),
      pollIntervalMs: 10,
      logger: { warn: vi.fn() }
    });
    const pushed: ChannelDesktopStatus[] = [];
    controller.subscribe((status) => {
      pushed.push(status);
    });
    await controller.start();
    pushed.length = 0;

    const reconnect = controller.reconnectNetwork();
    for (let attempt = 0; attempt < 10 && stopControl.resolve === null; attempt += 1) {
      await Promise.resolve();
    }
    expect(stopControl.resolve).not.toBeNull();
    await vi.advanceTimersByTimeAsync(10);

    expect(pushed.map((item) => item.lifecycle)).toEqual(['starting']);
    stopControl.resolve?.();
    const status = await reconnect;

    expect(status.lifecycle).toBe('connected');
    expect(pushed.map((item) => item.lifecycle)).toEqual(['starting', 'connected']);
    await controller.dispose();
  });

  test('setAutoConnect stores the generic channel preference', async () => {
    const preferences = createPreferencesStore();
    const controller = createWechatDesktopController({
      spawner: createFakeSpawner(),
      statusClient: createStatusClient([]),
      desktopPreferences: preferences,
      setDaemonWechatEnabled: vi.fn(() => Promise.resolve()),
      pollIntervalMs: 60_000,
      logger: { warn: vi.fn() }
    });

    await controller.setAutoConnect(true);

    await expect(preferences.get()).resolves.toEqual({
      channelAutoConnect: {
        wechat: true
      }
    });
  });
});

function createFakeSpawner(options: {
  stopDelay?: () => Promise<void>;
} = {}): DaemonSpawner & {
  startCalls: Array<{ env: NodeJS.ProcessEnv | undefined; args: string[] }>;
  stopCalls: number;
} {
  let running = false;
  let stopCalls = 0;
  let delayedStopUsed = false;
  const startCalls: Array<{ env: NodeJS.ProcessEnv | undefined; args: string[] }> = [];
  return {
    startCalls,
    get stopCalls(): number {
      return stopCalls;
    },
    start(env?: NodeJS.ProcessEnv, args: string[] = []): void {
      running = true;
      startCalls.push({ env, args });
    },
    async stop(): Promise<void> {
      if (options.stopDelay !== undefined && !delayedStopUsed) {
        delayedStopUsed = true;
        await options.stopDelay();
      }
      running = false;
      stopCalls += 1;
    },
    async restart(env?: NodeJS.ProcessEnv): Promise<void> {
      await Promise.resolve();
      running = false;
      stopCalls += 1;
      running = true;
      startCalls.push({ env, args: [] });
    },
    isRunning(): boolean {
      return running;
    },
    getStatus() {
      return running
        ? { lifecycle: 'running' as const, running: true }
        : { lifecycle: 'stopped' as const, running: false };
    },
    subscribe() {
      return () => undefined;
    }
  };
}

function createStatusClient(snapshots: Array<WechatGatewaySnapshot | Error>): WechatGatewayStatusClient {
  let index = 0;
  return {
    readSnapshot(): Promise<WechatGatewaySnapshot> {
      return readNextSnapshot();
    },
    deleteAccount(): Promise<WechatGatewaySnapshot> {
      return readNextSnapshot();
    },
    requestFreshQrLogin(): Promise<WechatGatewaySnapshot> {
      return readNextSnapshot();
    }
  };

  function readNextSnapshot(): Promise<WechatGatewaySnapshot> {
    const snapshot = snapshots[index] ?? snapshots.at(-1);
    index += 1;
    if (snapshot === undefined) {
      return Promise.reject(new Error('gateway unavailable'));
    }
    if (snapshot instanceof Error) {
      return Promise.reject(snapshot);
    }
    return Promise.resolve(snapshot);
  }
}

function createPreferencesStore(): DesktopPreferencesStore {
  let preferences: DesktopPreferences = {
    channelAutoConnect: {}
  };
  return {
    get: () => Promise.resolve(preferences),
    set(input): Promise<DesktopPreferences> {
      preferences = {
        ...preferences,
        ...input,
        channelAutoConnect: {
          ...preferences.channelAutoConnect,
          ...input.channelAutoConnect
        }
      };
      return Promise.resolve(preferences);
    }
  };
}

function createSnapshot(
  state: WechatGatewaySnapshot['connection']['state'],
  qrLoginUrl?: string,
  startedAt?: number,
  qrLoginExpiresAt?: number
): WechatGatewaySnapshot {
  return {
    ok: true,
    account: null,
    connection: {
      state,
      ...(startedAt === undefined ? {} : { startedAt }),
      ...(qrLoginUrl === undefined ? {} : { qrLoginUrl }),
      ...(qrLoginExpiresAt === undefined ? {} : { qrLoginExpiresAt })
    },
    outbound: {
      deferredReadyCount: 0,
      deferredClaimedCount: 0
    }
  };
}
