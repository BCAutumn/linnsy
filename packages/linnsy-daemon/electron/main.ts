import { app, BrowserWindow, ipcMain, type BrowserWindowConstructorOptions } from 'electron';
import { join } from 'node:path';

import { ChannelDesktopRegistry } from './channels/channel-desktop-registry.js';
import { resolveWechatGatewayStatusClientConfig } from './channels/wechat/wechat-gateway-config.js';
import { createWechatDesktopController } from './channels/wechat/wechat-desktop-controller.js';
import { inspectDesktopWechatGatewayPidfile } from './channels/wechat/wechat-gateway-pidfile.js';
import { createWechatGatewayStatusClient } from './channels/wechat/wechat-gateway-status-client.js';
import { createDesktopPreferencesStore, isChannelAutoConnectEnabled } from './desktop-preferences.js';
import { createDaemonSpawner, resolvePackageRoot } from './daemon-spawner.js';
import { registerIpcHandlers } from './ipc-handlers.js';
import {
  resolveLocalBearerTokens,
  type LocalBearerSpec,
  type LocalBearerTokens
} from './local-bearer-tokens.js';
import { createShutdownCoordinator, type ShutdownCoordinator } from './shutdown.js';
import { createDesktopTray, type DesktopTray } from './tray.js';
import { createUiHintStore } from './ui-hint-store.js';

const DEFAULT_RENDERER_URL = 'http://127.0.0.1:5173';
const DEFAULT_DAEMON_URL = 'http://127.0.0.1:7700';
const DEFAULT_WECHAT_GATEWAY_URL = 'http://127.0.0.1:7788';
const MIN_WINDOW_WIDTH = 900;

// 桌面壳所有"本机进程间 HTTP"鉴权 token 的注册表。
// 加新 channel 时只在这里追加一行 spec，main bootstrap 会自动解析、持久化、
// 注入到 daemon spawner 与 sidecar spawner 的 env 里。详见 local-bearer-tokens.ts。
const LOCAL_BEARER_SPECS: readonly LocalBearerSpec[] = [
  { envName: 'LINNSY_WEB_BEARER', storageKey: 'web' },
  { envName: 'LINNSY_WECHAT_GATEWAY_BEARER', storageKey: 'wechat-gateway' }
];

const packageRoot = resolvePackageRoot(import.meta.url);
const rendererUrl = process.env.LINNSY_RENDERER_URL ?? DEFAULT_RENDERER_URL;
const daemonUrl = process.env.LINNSY_DAEMON_URL ?? DEFAULT_DAEMON_URL;
let isQuitting = false;
let tray: DesktopTray | null = null;
let shutdown: ShutdownCoordinator | null = null;

// preload 通过 process.argv 同步拿到序列化后的 UI hint，在 renderer 第一行
// JS 之前就把 last-ui-hint.json 内容注入 window.__LINNSY_BOOT__，从根上消除
// "先白屏 → 切深色"的开屏闪烁。详见 docs/04 §6.5、ui-hint-store.ts。
//
// 不直接走 "preload 同步 readFileSync(filePath)"——Electron 33 默认
// sandbox: true，preload 不能 require('fs')，那条路径会让整段 preload
// 顶层 module load 失败 → contextBridge 永远不暴露 linnsyDesktop →
// renderer 静默走 dev-secret fallback → daemon 401。是上一轮排错的真凶。
const UI_HINT_ARG_PREFIX = '--linnsy-ui-hint=';

function createWindow(input: { uiHintPayload: string }): BrowserWindow {
  const windowOptions: BrowserWindowConstructorOptions = {
    width: 1280,
    height: 820,
    minWidth: MIN_WINDOW_WIDTH,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 14, y: 11 } } : {}),
    ...(process.platform === 'win32'
      ? {
          titleBarOverlay: {
            color: '#F4F8F5',
            symbolColor: '#595959',
            height: 38
          }
        }
      : {}),
    webPreferences: {
      preload: join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox 保持默认 true（强安全模型），preload 不再触碰 fs，
      // 启动期 hint 由 main 序列化后通过 argv 透传。
      additionalArguments: [`${UI_HINT_ARG_PREFIX}${input.uiHintPayload}`]
    }
  };
  const window = new BrowserWindow(windowOptions);
  installDevToolsShortcuts(window);

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    console.error(`[linnsy electron] failed to load ${validatedUrl}: ${errorCode.toString()} ${errorDescription}`);
  });

  window.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      window.hide();
    }
  });

  console.info(`[linnsy electron] loading renderer ${rendererUrl}`);
  return window;
}

function installDevToolsShortcuts(window: BrowserWindow): void {
  window.webContents.on('before-input-event', (event, input) => {
    const key = input.key.toLowerCase();
    const opensDevTools = ((input.meta || input.control) && input.shift && key === 'i')
      || (input.meta && input.alt && key === 'i');
    const opensDevToolsWithF12 = input.key === 'F12';
    if (!opensDevTools && !opensDevToolsWithF12) {
      return;
    }
    event.preventDefault();
    window.webContents.toggleDevTools();
  });
}

async function loadRenderer(window: BrowserWindow): Promise<void> {
  await window.loadURL(rendererUrl);
  window.center();
  window.show();
  window.showInactive();
  window.moveTop();
  window.focus();
  app.focus({ steal: true });
  console.info(`[linnsy electron] window visible at ${rendererUrl}`);
}

void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[linnsy electron] fatal bootstrap error\n${message}`);
  app.exit(1);
});

async function bootstrap(): Promise<void> {
  await app.whenReady();

  const bearers = await resolveLocalBearerTokens({
    userDataDir: app.getPath('userData'),
    specs: [...LOCAL_BEARER_SPECS]
  });
  const webBearer = requireBearer(bearers, 'LINNSY_WEB_BEARER');
  const wechatBearer = requireBearer(bearers, 'LINNSY_WECHAT_GATEWAY_BEARER');

  const localDaemon = createDaemonSpawner({
    packageRoot,
    externalModeEnv: 'LINNSY_EXTERNAL_DAEMON',
    env: buildDaemonSpawnerEnv({ daemonUrl, bearers }),
    onLog: (message) => {
      if (message.length > 0) {
        console.info(`[daemon] ${message}`);
      }
    }
  });
  const localWechatGateway = createDaemonSpawner({
    packageRoot,
    scriptName: 'dev:wechat-gateway',
    env: buildWechatGatewaySpawnerEnv({ bearers }),
    onLog: (message) => {
      if (message.length > 0) {
        console.info(`[wechat-gateway] ${message}`);
      }
    }
  });
  const desktopPreferences = createDesktopPreferencesStore(app);
  const preferences = await desktopPreferences.get();
  const wechatStatusClient = createWechatGatewayStatusClient(await resolveWechatGatewayStatusClientConfig({
    fallbackBaseUrl: DEFAULT_WECHAT_GATEWAY_URL,
    bearerToken: wechatBearer
  }));
  const channelRegistry = new ChannelDesktopRegistry();
  const shouldSpawnDaemon = process.env.LINNSY_ELECTRON_SPAWN_DAEMON === '1';
  const wechatAutoConnect = isChannelAutoConnectEnabled(preferences, 'wechat');
  const wechatController = createWechatDesktopController({
    spawner: localWechatGateway,
    statusClient: wechatStatusClient,
    desktopPreferences,
    setDaemonWechatEnabled: async (enabled) => {
      if (!shouldSpawnDaemon || !localDaemon.isRunning()) {
        return;
      }
      await localDaemon.restart({
        LINNSY_DESKTOP_WECHAT_CONNECT: enabled ? '1' : '0'
      });
    }
  });
  channelRegistry.register(wechatController);

  // 在拉起 sidecar 之前看一眼上次有没有孤儿。stale 自动清，live 给用户日志线索；
  // 不动 controller 的 probe/adopt 路径，避免误杀用户故意起的 dev gateway。
  await inspectDesktopWechatGatewayPidfile();

  if (wechatAutoConnect) {
    console.info(`[linnsy electron] starting wechat gateway sidecar`);
    await wechatController.start();
  }
  if (shouldSpawnDaemon) {
    console.info(`[linnsy electron] starting daemon sidecar`);
    localDaemon.start({
      LINNSY_DESKTOP_WECHAT_CONNECT: wechatAutoConnect ? '1' : '0'
    });
  } else {
    console.info(`[linnsy electron] daemon sidecar disabled`);
  }
  const uiHintStore = createUiHintStore({ userDataDir: app.getPath('userData') });
  // 启动期由 main 自己读盘 → 序列化为 JSON 字符串 → 通过 BrowserWindow
  // additionalArguments 透传给 sandboxed preload，preload 零 fs 依赖。
  // 文件不存在 / 损坏 / sanitize 不通过 → read() 已经返回 null，序列化
  // 为字符串 "null"，preload 解析后落到默认值兜底，与首次启动同行为。
  const initialUiHint = await uiHintStore.read();
  const window = createWindow({ uiHintPayload: JSON.stringify(initialUiHint) });
  const localShutdown = createShutdownCoordinator();
  // 注册顺序 = 真实拆解顺序：先停 channel sidecar（释放对外端口和 WeChat bot API 连接），
  // 再停 daemon（依赖 channel 已退），最后销毁 tray（纯本地资源）。
  localShutdown.register('channel-registry', () => channelRegistry.disposeAll());
  localShutdown.register('daemon-spawner', () => localDaemon.stop());
  localShutdown.register('tray', () => {
    tray?.destroy();
    tray = null;
  });
  shutdown = localShutdown;
  registerIpcHandlers({
    app,
    window,
    ipcMain,
    daemon: localDaemon,
    channelRegistry,
    apiConfig: {
      baseUrl: daemonUrl,
      bearerToken: webBearer
    },
    shutdown: localShutdown,
    uiHintStore
  });
  await loadRenderer(window);
  tray = createDesktopTray({
    window,
    daemon: localDaemon,
    requestQuit: () => {
      isQuitting = true;
      void localShutdown.run('tray-quit').finally(() => {
        app.exit(0);
      });
    }
  });
}

function buildDaemonSpawnerEnv(input: { daemonUrl: string; bearers: LocalBearerTokens }): NodeJS.ProcessEnv {
  const webBearer = requireBearer(input.bearers, 'LINNSY_WEB_BEARER');
  const wechatBearer = requireBearer(input.bearers, 'LINNSY_WECHAT_GATEWAY_BEARER');
  return {
    LINNSY_DESKTOP_MODE: '1',
    LINNSY_DAEMON_URL: input.daemonUrl,
    LINNSY_WEB_BEARER: webBearer,
    LINNSY_WEB_BEARER_TOKEN: webBearer,
    LINNSY_WECHAT_GATEWAY_BEARER: wechatBearer
  };
}

function buildWechatGatewaySpawnerEnv(input: { bearers: LocalBearerTokens }): NodeJS.ProcessEnv {
  return {
    LINNSY_WECHAT_GATEWAY_BEARER: requireBearer(input.bearers, 'LINNSY_WECHAT_GATEWAY_BEARER')
  };
}

function requireBearer(bearers: LocalBearerTokens, envName: string): string {
  const value = bearers[envName];
  if (value === undefined || value.length === 0) {
    // 兜底防御：bearers 永远应该包含 LOCAL_BEARER_SPECS 里所有 envName。
    // 真触发说明有人改了 spec 列表但没同步 build*SpawnerEnv 的访问。
    throw new Error(`local bearer ${envName} was not resolved; check LOCAL_BEARER_SPECS in main.ts`);
  }
  return value;
}

app.on('before-quit', (event) => {
  // before-quit 是所有原生退出路径（cmd+Q / dock / Alt+F4 / window-all-closed）的汇合点。
  // 之前这里只 destroy tray 不停 sidecar，导致 wechat-gateway 变孤儿（详见 docs/02 §4.10n）。
  // 现在所有路径都被 coordinator 兜住；preventDefault 后用 app.exit(0) 强退，避免再绕一圈。
  event.preventDefault();
  isQuitting = true;
  if (shutdown === null) {
    app.exit(0);
    return;
  }
  if (shutdown.hasStarted()) {
    return;
  }
  void shutdown.run('before-quit').finally(() => {
    app.exit(0);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    return;
  }
});
