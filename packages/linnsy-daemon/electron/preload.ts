import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import {
  type AutostartGetResult,
  type AutostartSetResult,
  DESKTOP_IPC_CHANNELS,
  type OkTrueResult,
  type PersistUiHintResult,
  type CodexSessionOpenInput,
  type CodexSessionOpenResult,
  type DesktopApiConfig,
  parseAutostartGetResult,
  parseAutostartSetResult,
  parseCodexSessionOpenInput,
  parseCodexSessionOpenResult,
  parseDesktopApiConfig,
  parseOkTrueResult,
  parsePersistUiHintResult
} from './ipc-contract.js';
import {
  type ChannelDesktopAction,
  type ChannelDesktopStatus,
  parseChannelDesktopAction,
  parseChannelDesktopStatus,
  parseChannelDesktopStatusList
} from '../src/domains/desktop-integration/definitions/desktop-channel-contract.js';
import { type DaemonDesktopStatus, parseDaemonDesktopStatus } from '../src/domains/desktop-integration/definitions/desktop-daemon-contract.js';
import { sanitizeUiHint, type UiHint } from '../src/domains/desktop-integration/definitions/ui-hint-contract.js';

function installPlatformDataset(): void {
  const root = document.querySelector<HTMLElement>('html');
  if (root === null) {
    document.addEventListener('DOMContentLoaded', installPlatformDataset, { once: true });
    return;
  }
  root.dataset.platform = process.platform;
}

installPlatformDataset();

export interface LinnsyDesktopBridge {
  getApiConfig(): Promise<DesktopApiConfig>;
  getDaemonStatus(): Promise<DaemonDesktopStatus>;
  onDaemonStatusChanged(listener: (status: DaemonDesktopStatus) => void): () => void;
  getAutostart(): Promise<AutostartGetResult>;
  setAutostart(enabled: boolean): Promise<AutostartSetResult>;
  listChannels(): Promise<ChannelDesktopStatus[]>;
  getChannelStatus(channelId: string): Promise<ChannelDesktopStatus>;
  invokeChannelAction(input: { channelId: string; action: ChannelDesktopAction }): Promise<ChannelDesktopStatus>;
  onChannelStatusChanged(listener: (status: ChannelDesktopStatus) => void): () => void;
  openCodexSession(input: CodexSessionOpenInput): Promise<CodexSessionOpenResult>;
  showWindow(): Promise<OkTrueResult>;
  hideWindow(): Promise<OkTrueResult>;
  quit(): Promise<OkTrueResult>;
  /** renderer 拿到 daemon 真实 ui-preferences 后 fire-and-forget 调这里持久化下次启动 hint。 */
  persistUiHint(hint: UiHint): Promise<PersistUiHintResult>;
}

export interface LinnsyBoot {
  /** 上次启动遗留的 UI 提示；首次启动 / 文件损坏 / sanitize 不通过 → null。 */
  uiHint: UiHint | null;
}

const UI_HINT_ARG_PREFIX = '--linnsy-ui-hint=';

const bridge: LinnsyDesktopBridge = {
  getApiConfig: () => invokeAndParse(DESKTOP_IPC_CHANNELS.getApiConfig, parseDesktopApiConfig),
  getDaemonStatus: () => invokeAndParse(DESKTOP_IPC_CHANNELS.daemonStatus, parseDaemonDesktopStatus),
  onDaemonStatusChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, status: unknown): void => {
      notifyParsedStatus('daemon status changed', status, parseDaemonDesktopStatus, listener);
    };
    ipcRenderer.on(DESKTOP_IPC_CHANNELS.daemonStatusChanged, handler);
    return () => {
      ipcRenderer.off(DESKTOP_IPC_CHANNELS.daemonStatusChanged, handler);
    };
  },
  getAutostart: () => invokeAndParse(DESKTOP_IPC_CHANNELS.autostartGet, parseAutostartGetResult),
  setAutostart: (enabled) => {
    if (typeof enabled !== 'boolean') {
      throw new Error('invalid autostart enabled value');
    }
    return invokeAndParse(DESKTOP_IPC_CHANNELS.autostartSet, parseAutostartSetResult, enabled);
  },
  listChannels: () => invokeAndParse(DESKTOP_IPC_CHANNELS.channelsList, parseChannelDesktopStatusList),
  getChannelStatus: (channelId) => invokeAndParse(DESKTOP_IPC_CHANNELS.channelsGet, parseChannelDesktopStatus, channelId),
  invokeChannelAction: (input) => {
    if (typeof input.channelId !== 'string' || input.channelId.trim().length === 0) {
      throw new Error('invalid desktop channel id');
    }
    return invokeAndParse(
      DESKTOP_IPC_CHANNELS.channelsInvoke,
      parseChannelDesktopStatus,
      {
        channelId: input.channelId,
        action: parseChannelDesktopAction(input.action)
      }
    );
  },
  onChannelStatusChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, status: unknown): void => {
      notifyParsedStatus('channel status changed', status, parseChannelDesktopStatus, listener);
    };
    ipcRenderer.on(DESKTOP_IPC_CHANNELS.channelsStatusChanged, handler);
    return () => {
      ipcRenderer.off(DESKTOP_IPC_CHANNELS.channelsStatusChanged, handler);
    };
  },
  openCodexSession: (input) => invokeAndParse(
    DESKTOP_IPC_CHANNELS.codexSessionOpen,
    parseCodexSessionOpenResult,
    parseCodexSessionOpenInput(input)
  ),
  showWindow: () => invokeAndParse(DESKTOP_IPC_CHANNELS.windowShow, parseOkTrueResult),
  hideWindow: () => invokeAndParse(DESKTOP_IPC_CHANNELS.windowHide, parseOkTrueResult),
  quit: () => invokeAndParse(DESKTOP_IPC_CHANNELS.appQuit, parseOkTrueResult),
  persistUiHint: (hint) => {
    const sanitized = sanitizeUiHint(hint);
    if (sanitized === null) {
      throw new Error('invalid ui hint');
    }
    return invokeAndParse(DESKTOP_IPC_CHANNELS.persistUiHint, parsePersistUiHintResult, sanitized);
  }
};

contextBridge.exposeInMainWorld('linnsyDesktop', bridge);

// 同步从 process.argv 解析 main bootstrap 期序列化好的 hint → 注入
// window.__LINNSY_BOOT__。preload 在 renderer 第一行 JS 执行前跑完，因此
// applyEarlyThemeMode() 与 AppShell 初始 state 都能直接吃到 hint，不会
// 经历"先白屏 → 切深色"这种异步 fetch 延迟造成的开屏闪烁。
//
// 不直接 readFileSync——Electron 33 默认 sandbox: true，preload 不能 require('fs')，
// 那条路径会让整段 preload 顶层 module load 失败，contextBridge 永远不暴露
// linnsyDesktop，renderer 必然走 dev-secret fallback 撞到 daemon 401。
// argv 是 sandbox 白名单，安全且零 IO；hint 一律由 main 在 bootstrap 期
// 自己读盘并序列化，preload 只负责 parse + sanitize 兜底。详见 docs/04 §6.5。
contextBridge.exposeInMainWorld('__LINNSY_BOOT__', readBootHint());

function readBootHint(): LinnsyBoot {
  const arg = process.argv.find((entry) => entry.startsWith(UI_HINT_ARG_PREFIX));
  if (arg === undefined) {
    return { uiHint: null };
  }
  const payload = arg.slice(UI_HINT_ARG_PREFIX.length);
  if (payload.length === 0) {
    return { uiHint: null };
  }
  try {
    const parsed = JSON.parse(payload) as unknown;
    return { uiHint: sanitizeUiHint(parsed) };
  } catch {
    return { uiHint: null };
  }
}

async function invokeAndParse<T>(
  channel: string,
  parse: (value: unknown) => T,
  ...args: unknown[]
): Promise<T> {
  const value: unknown = await ipcRenderer.invoke(channel, ...args);
  return parse(value);
}

function notifyParsedStatus<T>(
  label: string,
  value: unknown,
  parse: (input: unknown) => T,
  listener: (value: T) => void
): void {
  try {
    listener(parse(value));
  } catch (error: unknown) {
    console.warn(`[linnsy preload] ignored invalid ${label} payload: ${String(error)}`);
  }
}
