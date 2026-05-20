import {
  isChannelAutoConnectEnabled,
  setChannelAutoConnectPreference,
  type DesktopPreferencesStore
} from '../../desktop-preferences.js';
import type { DaemonSpawner } from '../../daemon-spawner.js';

import type { ChannelDesktopController, ChannelDesktopStatus, ChannelDesktopStatusListener } from '../types.js';
import {
  isWechatGatewayStatusHttpError,
  type WechatGatewaySnapshot,
  type WechatGatewayStatusClient
} from './wechat-gateway-status-client.js';

export interface CreateWechatDesktopControllerOptions {
  spawner: DaemonSpawner;
  statusClient: WechatGatewayStatusClient;
  desktopPreferences: DesktopPreferencesStore;
  setDaemonWechatEnabled(enabled: boolean): Promise<void>;
  pollIntervalMs?: number;
  logger?: Pick<Console, 'warn'>;
}

const CHANNEL_ID = 'wechat';
const DEFAULT_POLL_INTERVAL_MS = 1_500;
const OPERATION_WINDOW_MS = 3_000;
type ExistingGatewayProbeResult = 'adopted' | 'blocked' | 'unavailable';

export function createWechatDesktopController(
  options: CreateWechatDesktopControllerOptions
): ChannelDesktopController {
  const listeners = new Set<ChannelDesktopStatusListener>();
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const logger = options.logger ?? console;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastStatus: ChannelDesktopStatus = {
    channelId: CHANNEL_ID,
    lifecycle: 'idle',
    autoConnect: false
  };
  let lastStatusError: string | null = null;
  let hasReadGatewaySnapshot = false;
  let usesExternalGateway = false;
  let operationWindowUntil = 0;

  const controller: ChannelDesktopController = {
    channelId: CHANNEL_ID,

    async start(): Promise<ChannelDesktopStatus> {
      hasReadGatewaySnapshot = false;
      usesExternalGateway = false;
      await emitStarting();
      const existingGateway = !options.spawner.isRunning()
        ? await probeExistingGateway()
        : 'unavailable';
      if (existingGateway === 'adopted') {
        await options.setDaemonWechatEnabled(true);
        ensurePolling();
        return lastStatus;
      }
      if (existingGateway === 'blocked') {
        return lastStatus;
      }
      options.spawner.start();
      await options.setDaemonWechatEnabled(true);
      ensurePolling();
      await refreshStatus({ startingOnFailure: true });
      return lastStatus;
    },

    async stop(): Promise<ChannelDesktopStatus> {
      await options.spawner.stop();
      await options.setDaemonWechatEnabled(false);
      hasReadGatewaySnapshot = false;
      usesExternalGateway = false;
      stopPolling();
      emitStatus(await createStatus('idle'));
      return lastStatus;
    },

    async reconnectNetwork(): Promise<ChannelDesktopStatus> {
      beginOperationWindow();
      try {
        hasReadGatewaySnapshot = false;
        usesExternalGateway = false;
        await emitStarting();
        await options.spawner.stop();
        const existingGateway = await probeExistingGateway();
        if (existingGateway === 'blocked') {
          return lastStatus;
        }
        if (existingGateway === 'adopted') {
          emitStatus(await createStatus(
            'degraded',
            'Cannot reconnect network while another WeChat gateway is already listening; stop that process first.'
          ));
          return lastStatus;
        }
        options.spawner.start();
        await options.setDaemonWechatEnabled(true);
        ensurePolling();
        endOperationWindow();
        await refreshStatus({ startingOnFailure: true });
        return lastStatus;
      } finally {
        endOperationWindow();
      }
    },

    async deleteAccount(): Promise<ChannelDesktopStatus> {
      beginOperationWindow();
      let keepStaleConnectedGuard = false;
      try {
        await emitStarting();
        if (!isGatewayRunning()) {
          const existingGateway = await probeExistingGateway();
          if (existingGateway === 'blocked') {
            return lastStatus;
          }
          if (existingGateway === 'unavailable') {
            options.spawner.start();
            await options.setDaemonWechatEnabled(true);
            ensurePolling();
          }
        }

        try {
          const snapshot = await options.statusClient.deleteAccount();
          hasReadGatewaySnapshot = true;
          usesExternalGateway = usesExternalGateway || !options.spawner.isRunning();
          lastStatusError = null;
          emitStatus(await mapWechatGatewaySnapshot(snapshot));
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          emitStatus(await createStatus('degraded', message));
        }
        // 删除账号后 gateway 可能短时间回灌旧 connected 快照，保留一个短暂保护窗；
        // 没真正执行 delete 的 early return 会在 finally 里关闭窗口。
        keepStaleConnectedGuard = true;
        return lastStatus;
      } finally {
        if (!keepStaleConnectedGuard) {
          endOperationWindow();
        }
      }
    },

    async requestQrCode(): Promise<ChannelDesktopStatus> {
      beginOperationWindow();
      await emitAwaitingLogin();
      if (!isGatewayRunning()) {
        const existingGateway = await probeExistingGateway();
        if (existingGateway === 'blocked') {
          return lastStatus;
        }
        if (existingGateway === 'unavailable') {
          options.spawner.start();
          await options.setDaemonWechatEnabled(true);
          ensurePolling();
        }
      }

      try {
        const snapshot = await options.statusClient.requestFreshQrLogin();
        hasReadGatewaySnapshot = true;
        usesExternalGateway = usesExternalGateway || !options.spawner.isRunning();
        lastStatusError = null;
        emitStatus(await mapWechatGatewaySnapshot(snapshot));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        emitStatus(await createStatus('degraded', message));
      } finally {
        endOperationWindow();
      }
      return lastStatus;
    },

    async setAutoConnect(enabled: boolean): Promise<ChannelDesktopStatus> {
      const preferences = await options.desktopPreferences.get();
      await options.desktopPreferences.set(setChannelAutoConnectPreference(preferences, CHANNEL_ID, enabled));
      await refreshStatus({ startingOnFailure: true });
      return lastStatus;
    },

    async getStatus(): Promise<ChannelDesktopStatus> {
      await refreshStatus({ startingOnFailure: true });
      return lastStatus;
    },

    subscribe(listener: ChannelDesktopStatusListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async dispose(): Promise<void> {
      stopPolling();
      await options.spawner.stop();
    }
  };

  return controller;

  async function emitStarting(): Promise<void> {
    emitStatus(await createStatus('starting'));
  }

  async function emitAwaitingLogin(): Promise<void> {
    emitStatus(await createStatus('awaiting_login'));
  }

  async function refreshStatus(input: { startingOnFailure: boolean }): Promise<void> {
    if (!isGatewayRunning()) {
      if (lastStatus.lifecycle === 'starting' && await adoptExistingGateway()) {
        return;
      }
      emitStatus(await createStatus('idle'));
      return;
    }

    try {
      const snapshot = await options.statusClient.readSnapshot();
      hasReadGatewaySnapshot = true;
      lastStatusError = null;
      emitStatus(await mapWechatGatewaySnapshot(snapshot));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (lastStatusError !== message) {
        logger.warn(`[linnsy electron] failed to read wechat gateway status: ${message}`);
        lastStatusError = message;
      }
      // 冷启动期 HTTP 端口可能还没监听成功。只有网关状态曾经成功读到过，
      // 后续失败才表示连接退化；否则继续维持 starting，避免 UI 来回闪烁。
      const lifecycle = !hasReadGatewaySnapshot && input.startingOnFailure && lastStatus.lifecycle !== 'connected'
        ? 'starting'
        : 'degraded';
      emitStatus(await createStatus(lifecycle, message));
    }
  }

  async function mapWechatGatewaySnapshot(snapshot: WechatGatewaySnapshot): Promise<ChannelDesktopStatus> {
    const autoConnect = await readAutoConnect();
    switch (snapshot.connection.state) {
      case 'not_connected':
        return isGatewayRunning() && snapshot.connection.startedAt !== undefined
          ? { channelId: CHANNEL_ID, lifecycle: 'awaiting_login', autoConnect }
          : { channelId: CHANNEL_ID, lifecycle: 'idle', autoConnect };
      case 'starting':
        return { channelId: CHANNEL_ID, lifecycle: 'starting', autoConnect };
      case 'awaiting_qr_scan':
        if (snapshot.connection.qrLoginUrl === undefined) {
          return {
            channelId: CHANNEL_ID,
            lifecycle: 'degraded',
            autoConnect,
            detail: 'wechat gateway is awaiting QR scan without qrLoginUrl'
          };
        }
        return {
          channelId: CHANNEL_ID,
          lifecycle: 'awaiting_login',
          autoConnect,
          loginHint: {
            kind: 'qr',
            url: snapshot.connection.qrLoginUrl,
            ...(snapshot.connection.qrLoginExpiresAt === undefined ? {} : { expiresAt: snapshot.connection.qrLoginExpiresAt })
          }
        };
      case 'connected':
        return { channelId: CHANNEL_ID, lifecycle: 'connected', autoConnect };
      case 'degraded':
        return {
          channelId: CHANNEL_ID,
          lifecycle: 'degraded',
          autoConnect,
          ...(snapshot.connection.lastPollError === undefined ? {} : { detail: snapshot.connection.lastPollError })
        };
    }
  }

  async function createStatus(
    lifecycle: ChannelDesktopStatus['lifecycle'],
    detail?: string
  ): Promise<ChannelDesktopStatus> {
    return {
      channelId: CHANNEL_ID,
      lifecycle,
      autoConnect: await readAutoConnect(),
      ...(detail === undefined ? {} : { detail })
    };
  }

  async function readAutoConnect(): Promise<boolean> {
    return isChannelAutoConnectEnabled(await options.desktopPreferences.get(), CHANNEL_ID);
  }

  async function adoptExistingGateway(): Promise<boolean> {
    return await probeExistingGateway() === 'adopted';
  }

  async function probeExistingGateway(): Promise<ExistingGatewayProbeResult> {
    try {
      const snapshot = await options.statusClient.readSnapshot();
      hasReadGatewaySnapshot = true;
      usesExternalGateway = true;
      lastStatusError = null;
      emitStatus(await mapWechatGatewaySnapshot(snapshot));
      return 'adopted';
    } catch (error: unknown) {
      if (isWechatGatewayStatusHttpError(error) && (error.status === 401 || error.status === 403)) {
        emitStatus(await createStatus(
          'degraded',
          'A WeChat gateway is already listening, but it rejected the desktop bearer token. Check LINNSY_WECHAT_GATEWAY_BEARER.'
        ));
        return 'blocked';
      }
      return 'unavailable';
    }
  }

  function isGatewayRunning(): boolean {
    return options.spawner.isRunning() || usesExternalGateway;
  }

  function emitStatus(status: ChannelDesktopStatus): void {
    if (isStaleConnectedStatus(status)) {
      return;
    }
    if (JSON.stringify(status) === JSON.stringify(lastStatus)) {
      return;
    }
    lastStatus = status;
    for (const listener of listeners) {
      listener(status);
    }
  }

  function beginOperationWindow(): void {
    operationWindowUntil = Date.now() + OPERATION_WINDOW_MS;
  }

  function endOperationWindow(): void {
    operationWindowUntil = 0;
  }

  function isStaleConnectedStatus(status: ChannelDesktopStatus): boolean {
    return status.lifecycle === 'connected'
      && Date.now() < operationWindowUntil
      && (
        lastStatus.lifecycle === 'starting'
        || lastStatus.lifecycle === 'awaiting_login'
        || lastStatus.lifecycle === 'degraded'
      );
  }

  function ensurePolling(): void {
    if (pollTimer !== null) {
      return;
    }
    pollTimer = setInterval(() => {
      void refreshStatus({ startingOnFailure: true });
    }, pollIntervalMs);
  }

  function stopPolling(): void {
    if (pollTimer === null) {
      return;
    }
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
