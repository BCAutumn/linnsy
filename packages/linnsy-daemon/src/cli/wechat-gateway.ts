import type { Command } from 'commander';
import { join } from 'node:path';

import { loadLinnsyConfig } from '../config/loader.js';
import { createWechatAccountStore } from '../domains/channel/features/wechat/gateway/account-store.js';
import {
  createWechatQrLoginClient,
  DEFAULT_WECHAT_BOT_API_BASE_URL
} from '../domains/channel/features/wechat/gateway/login-client.js';
import { createWechatBotApiClient } from '../domains/channel/features/wechat/gateway/wechat-bot-api-client.js';
import { createContextTokenStore } from '../domains/channel/features/wechat/gateway/context-token-store.js';
import { createOutboundQueue } from '../domains/channel/features/wechat/gateway/outbound-queue.js';
import {
  createWechatGatewayPidfileStore,
  hashWechatGatewayBearer
} from '../domains/channel/features/wechat/gateway/pidfile-store.js';
import { createWechatGatewayRunner } from '../domains/channel/features/wechat/gateway/runner.js';
import { createWechatGatewayStatusTracker } from '../domains/channel/features/wechat/gateway/gateway-status.js';

import type { CliCommand } from './types.js';
import type {
  ContextTokenStorePort,
  OutboundQueuePort,
  WechatGatewayAccount,
  WechatGatewayConnectionSource,
  WechatGatewayStatus,
  WechatGatewayStatusPort
} from '../domains/channel/features/wechat/gateway/types.js';
import type { FailedWechatQrConfirmationResult } from '../domains/channel/features/wechat/gateway/login-client.js';
import type { WechatBotApiPort } from '../domains/channel/features/wechat/gateway/wechat-bot-api-client.js';

const QR_LOGIN_TIMEOUT_MS = 8 * 60_000;

export function createWechatGatewayCommand(): CliCommand {
  return {
    name: 'wechat-gateway',
    description: 'Run the local WeChat gateway',
    register(command: Command): void {
      command
        .option('--delete-account', 'delete saved WeChat account data')
        .action(async (options: { deleteAccount?: boolean }) => {
          await runWechatGatewayCommand({
            deleteAccount: options.deleteAccount === true
          });
        });
    }
  };
}

async function runWechatGatewayCommand(input: { deleteAccount: boolean }): Promise<void> {
  const config = await loadLinnsyConfig();
  const wechat = config.channels.wechat;
  if (wechat === undefined || !wechat.enabled) {
    throw new Error('WeChat channel is disabled in config');
  }

  const stateDir = join(config.home, 'wechat-gateway');
  const accountStore = createWechatAccountStore({ stateDir });
  const tokenStore = createContextTokenStore({ stateDir });
  const queue = createOutboundQueue({ stateDir });
  const pidfileStore = createWechatGatewayPidfileStore({ stateDir });
  if (input.deleteAccount) {
    await accountStore.clear();
    await tokenStore.clear();
    await queue.clear();
  }

  const status = createWechatGatewayStatusTracker({ queue });
  let activeWechatBotApi: WechatBotApiPort | null = null;
  let loginGeneration = 0;
  const loginRuntime = createWechatGatewayLoginRuntime({
    wechat,
    accountStore,
    tokenStore,
    queue,
    status,
    setWechatBotApi: (wechatBotApi) => {
      activeWechatBotApi = wechatBotApi;
    },
    nextGeneration: () => {
      loginGeneration += 1;
      return loginGeneration;
    },
    isCurrentGeneration: (generation) => generation === loginGeneration
  });
  const runner = createWechatGatewayRunner({
    bind: wechat.gateway_bind,
    bearerToken: readRequiredEnv(wechat.bearer_env),
    runtime: {
      getWechatBotApi: () => activeWechatBotApi,
      deleteAccount: () => loginRuntime.deleteAccount(),
      requestFreshQrLogin: () => loginRuntime.requestFreshQrLogin()
    },
    tokenStore,
    queue,
    status
  });

  status.recordGatewayStarting(Date.now());
  await runner.start();
  // pidfile 在 runner.start 成功之后才落盘——确保它只在端口真正绑定后存在；
  // start 失败时端口没起来，也不应该留下"我在跑"的痕迹。SIGKILL 会绕过 finally
  // 留 stale 文件，那是 inspector 在下次启动时清的兜底场景。
  await pidfileStore.write({
    pid: process.pid,
    startedAt: Date.now(),
    bind: wechat.gateway_bind,
    bearerHash: hashWechatGatewayBearer(readRequiredEnv(wechat.bearer_env))
  });

  try {
    await loginRuntime.bootstrap();
  } catch (error: unknown) {
    await runner.stop();
    await pidfileStore.clear();
    throw error;
  }
  try {
    await waitForStdinCloseOrInterrupt();
  } finally {
    await runner.stop();
    await pidfileStore.clear();
  }
}

interface WechatGatewayLoginRuntime {
  bootstrap(): Promise<void>;
  deleteAccount(): Promise<WechatGatewayStatus>;
  requestFreshQrLogin(): Promise<WechatGatewayStatus>;
}

function createWechatGatewayLoginRuntime(input: {
  wechat: {
    wechat_bot_api_base_url?: string | undefined;
    wechat_bot_api_token_env?: string | undefined;
  };
  accountStore: {
    get(): Promise<WechatGatewayAccount | null>;
    save(input: WechatGatewayAccount): Promise<void>;
    clear(): Promise<void>;
  };
  tokenStore: ContextTokenStorePort;
  queue: OutboundQueuePort;
  status: WechatGatewayStatusPort;
  setWechatBotApi(wechatBotApi: WechatBotApiPort | null): void;
  nextGeneration(): number;
  isCurrentGeneration(generation: number): boolean;
}): WechatGatewayLoginRuntime {
  let qrExpiryTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingQrLogin: Promise<WechatGatewayStatus> | null = null;

  return {
    async bootstrap(): Promise<void> {
      const manualTokenEnv = input.wechat.wechat_bot_api_token_env;
      if (manualTokenEnv !== undefined) {
        connectAccount({
          account: {
            accountId: 'manual-wechat-bot-api',
            botToken: readRequiredEnv(manualTokenEnv),
            baseUrl: input.wechat.wechat_bot_api_base_url ?? DEFAULT_WECHAT_BOT_API_BASE_URL,
            connectedAt: Date.now()
          },
          connectionSource: 'manual_env'
        });
        return;
      }

      const saved = await input.accountStore.get();
      if (saved !== null) {
        console.log(`reusing saved WeChat account ${saved.accountId}`);
        connectAccount({
          account: saved,
          connectionSource: 'saved_account'
        });
        return;
      }
    },

    async deleteAccount(): Promise<WechatGatewayStatus> {
      if (input.wechat.wechat_bot_api_token_env !== undefined) {
        throw new Error('wechat_gateway_manual_account_cannot_delete');
      }

      input.setWechatBotApi(null);
      await input.accountStore.clear();
      await input.tokenStore.clear();
      await input.queue.clear();
      input.status.recordAccountCleared(Date.now());
      clearQrExpiryTimer();
      return input.status.snapshot();
    },

    requestFreshQrLogin(): Promise<WechatGatewayStatus> {
      if (pendingQrLogin !== null) {
        return pendingQrLogin;
      }
      const generation = input.nextGeneration();
      const request = startFreshQrLogin(generation).finally(() => {
        if (pendingQrLogin === request) {
          pendingQrLogin = null;
        }
      });
      pendingQrLogin = request;
      return request;
    }
  };

  function connectAccount(resolved: {
    account: WechatGatewayAccount;
    connectionSource: WechatGatewayConnectionSource;
  }): void {
    clearQrExpiryTimer();
    input.setWechatBotApi(createWechatBotApiClient({
      baseUrl: resolved.account.baseUrl,
      botToken: resolved.account.botToken
    }));
    input.status.recordAccountConnected(Date.now(), resolved.account, resolved.connectionSource);
    console.log(`wechat gateway connected as ${resolved.account.accountId}`);
  }

  async function startFreshQrLogin(generation: number): Promise<WechatGatewayStatus> {
    const loginClient = createWechatQrLoginClient({
      fixedBaseUrl: input.wechat.wechat_bot_api_base_url ?? DEFAULT_WECHAT_BOT_API_BASE_URL
    });
    const qr = await loginClient.start();
    if (!input.isCurrentGeneration(generation)) {
      return input.status.snapshot();
    }

    input.status.recordQrIssued(Date.now(), qr.qrUrl, qr.expiresAt);
    scheduleQrExpiry(generation, qr.expiresAt);
    await writeWechatQrLoginInstructions({
      qrUrl: qr.qrUrl,
      stdout: console.log,
      renderQr: renderWechatQrCode
    });

    void loginClient.waitForConfirmation({
      qrcode: qr.qrcode,
      timeoutMs: QR_LOGIN_TIMEOUT_MS
    }).then(async (confirmed) => {
      if (!input.isCurrentGeneration(generation)) {
        return;
      }
      if (!confirmed.connected) {
        clearQrExpiryTimer();
        input.status.recordQrExpired(Date.now());
        return;
      }

      await input.accountStore.save(confirmed.account);
      if (!input.isCurrentGeneration(generation)) {
        return;
      }
      connectAccount({
        account: confirmed.account,
        connectionSource: 'fresh_qr'
      });
    }).catch((error: unknown) => {
      if (!input.isCurrentGeneration(generation)) {
        return;
      }
      clearQrExpiryTimer();
      input.status.recordQrCleared(Date.now());
      input.status.recordPollFailure(Date.now(), error instanceof Error ? error.message : String(error));
    });

    return input.status.snapshot();
  }

  function scheduleQrExpiry(generation: number, expiresAt: number): void {
    clearQrExpiryTimer();
    const delayMs = Math.max(0, expiresAt - Date.now());
    qrExpiryTimer = setTimeout(() => {
      qrExpiryTimer = null;
      if (!input.isCurrentGeneration(generation)) {
        return;
      }
      input.status.recordQrExpired(Date.now());
    }, delayMs);
  }

  function clearQrExpiryTimer(): void {
    if (qrExpiryTimer === null) {
      return;
    }
    clearTimeout(qrExpiryTimer);
    qrExpiryTimer = null;
  }
}

export async function writeWechatQrLoginInstructions(input: {
  qrUrl: string;
  stdout: (message: string) => void;
  renderQr: (qrUrl: string) => Promise<string | null>;
}): Promise<void> {
  const renderedQr = await input.renderQr(input.qrUrl);
  if (renderedQr !== null) {
    input.stdout('Scan this QR code with WeChat:');
    input.stdout(renderedQr);
    input.stdout('If the QR does not render clearly, open this URL instead:');
    input.stdout(input.qrUrl);
    return;
  }

  input.stdout('Open this QR URL on your computer screen and scan it with WeChat:');
  input.stdout(input.qrUrl);
}

export function describeWechatQrLoginFailure(result: FailedWechatQrConfirmationResult): string {
  if (result.reason === 'expired') {
    return 'WeChat QR login expired before it was confirmed';
  }
  return 'WeChat QR login timed out before it was confirmed';
}

async function renderWechatQrCode(qrUrl: string): Promise<string | null> {
  try {
    const qrTerminal = await import('qrcode-terminal');
    return await new Promise((resolve) => {
      let settled = false;
      const finish = (value: string | null): void => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(value);
      };

      qrTerminal.default.generate(qrUrl, { small: true }, (qr) => {
        finish(qr.trimEnd());
      });
      setTimeout(() => {
        finish(null);
      }, 0);
    });
  } catch {
    return null;
  }
}

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function waitForStdinCloseOrInterrupt(): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      process.stdin.off('end', finish);
      process.stdin.off('close', finish);
      process.off('SIGINT', finish);
      process.off('SIGTERM', finish);
      resolve();
    };

    process.stdin.on('end', finish);
    process.stdin.on('close', finish);
    process.once('SIGINT', finish);
    process.once('SIGTERM', finish);
  });
}
