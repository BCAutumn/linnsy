import { createDaemonApiClient, type DaemonApiClient } from './daemon-api.js';
import type {
  ChannelDesktopAction,
  ChannelDesktopStatus
} from '@renderer/contracts';
import type { DaemonDesktopStatus } from '@renderer/contracts';
import type { UiHint } from '@renderer/contracts';

export interface CodexSessionOpenInput {
  sessionId: string;
  cwd?: string;
}

export interface CodexSessionOpenResult {
  ok: true;
  mode: 'terminal';
}

export interface DesktopApiConfig {
  baseUrl: string;
  bearerToken: string;
}

export type { DaemonDesktopStatus };

export interface LinnsyDesktopBridge {
  getApiConfig(): Promise<DesktopApiConfig>;
  getDaemonStatus?(): Promise<DaemonDesktopStatus>;
  onDaemonStatusChanged?(listener: (status: DaemonDesktopStatus) => void): () => void;
  listChannels?(): Promise<ChannelDesktopStatus[]>;
  getChannelStatus?(channelId: string): Promise<ChannelDesktopStatus>;
  invokeChannelAction?(input: { channelId: string; action: ChannelDesktopAction }): Promise<ChannelDesktopStatus>;
  onChannelStatusChanged?(listener: (status: ChannelDesktopStatus) => void): () => void;
  openCodexSession?(input: CodexSessionOpenInput): Promise<CodexSessionOpenResult>;
  /** 桌面壳启动期 UI 提示落盘；renderer 拿到 daemon 真实偏好后 fire-and-forget。详见 docs/04 §6.5。 */
  persistUiHint?(hint: UiHint): Promise<{ ok: boolean }>;
}

/** preload 同步注入的启动期窗口对象。dev 浏览器无 preload 时为 undefined。 */
export interface LinnsyBoot {
  uiHint: UiHint | null;
}

declare global {
  interface Window {
    linnsyDesktop?: LinnsyDesktopBridge;
    __LINNSY_BOOT__?: LinnsyBoot;
  }
}

export async function createDefaultDaemonClient(): Promise<DaemonApiClient> {
  const config = await readApiConfig();
  return createDaemonApiClient(config);
}

export function getDesktopBridge(): LinnsyDesktopBridge | undefined {
  return window.linnsyDesktop;
}

async function readApiConfig(): Promise<DesktopApiConfig> {
  // 必须经 preload 同步暴露的 window.linnsyDesktop 拿真实 bearer。
  // 任何未走 Electron 桌面壳的入口（裸浏览器开 vite dev server / preload
  // 顶层崩 / contextIsolation 配置漂移）→ window.linnsyDesktop 缺失 →
  // 这里直接抛错而不是悄悄退化到 'dev-secret' 静默 401。详见 docs/04 §6.4 / §6.5。
  if (window.linnsyDesktop === undefined) {
    throw new Error(
      'Linnsy desktop bridge missing: renderer must be loaded by the Electron shell. '
      + 'Open the app via `npm run dev:electron`; the bare vite dev server at 127.0.0.1:5173 '
      + 'has no preload bearer and is intentionally rejected.'
    );
  }
  return window.linnsyDesktop.getApiConfig();
}
