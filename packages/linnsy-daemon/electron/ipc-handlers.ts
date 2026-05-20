import { spawn } from 'node:child_process';

import { type App, type BrowserWindow, type IpcMain } from 'electron';

import { createAutostartController } from './autostart.js';
import type { ChannelDesktopRegistry } from './channels/channel-desktop-registry.js';
import type { DaemonSpawner } from './daemon-spawner.js';
import {
  DESKTOP_IPC_CHANNELS,
  type CodexSessionOpenInput,
  type CodexSessionOpenResult,
  type DesktopApiConfig
} from './ipc-contract.js';
import type { ShutdownCoordinator } from './shutdown.js';
import type { UiHintStore } from './ui-hint-store.js';
import { sanitizeUiHint } from '../src/domains/desktop-integration/definitions/ui-hint-contract.js';

export interface RegisterIpcHandlersOptions {
  app: App;
  window: BrowserWindow;
  ipcMain: IpcMain;
  daemon: DaemonSpawner;
  channelRegistry: ChannelDesktopRegistry;
  apiConfig: DesktopApiConfig;
  shutdown: ShutdownCoordinator;
  uiHintStore: UiHintStore;
}

export function registerIpcHandlers(options: RegisterIpcHandlersOptions): void {
  const autostart = createAutostartController(options.app);

  options.ipcMain.handle(DESKTOP_IPC_CHANNELS.getApiConfig, () => options.apiConfig);
  options.ipcMain.handle(DESKTOP_IPC_CHANNELS.windowShow, () => {
    options.window.show();
    return { ok: true };
  });
  options.ipcMain.handle(DESKTOP_IPC_CHANNELS.windowHide, () => {
    options.window.hide();
    return { ok: true };
  });
  options.ipcMain.handle(DESKTOP_IPC_CHANNELS.autostartGet, () => ({
    enabled: autostart.isEnabled()
  }));
  options.ipcMain.handle(DESKTOP_IPC_CHANNELS.autostartSet, (_event, enabled: boolean) => {
    autostart.setEnabled(enabled);
    return { ok: true, enabled };
  });
  options.ipcMain.handle(DESKTOP_IPC_CHANNELS.daemonStatus, () => options.daemon.getStatus());
  options.daemon.subscribe((status) => {
    options.window.webContents.send(DESKTOP_IPC_CHANNELS.daemonStatusChanged, status);
  });
  options.ipcMain.handle(DESKTOP_IPC_CHANNELS.channelsList, () => options.channelRegistry.list());
  options.ipcMain.handle(DESKTOP_IPC_CHANNELS.channelsGet, (_event, channelId: string) => (
    options.channelRegistry.get(channelId).getStatus()
  ));
  options.ipcMain.handle(DESKTOP_IPC_CHANNELS.channelsInvoke, (_event, input: unknown) => {
    const parsed = parseChannelInvokeInput(input);
    return options.channelRegistry.invoke(parsed.channelId, parsed.action);
  });
  options.channelRegistry.subscribeAll((status) => {
    options.window.webContents.send(DESKTOP_IPC_CHANNELS.channelsStatusChanged, status);
  });
  options.ipcMain.handle(DESKTOP_IPC_CHANNELS.codexSessionOpen, async (_event, input: unknown) => {
    const parsed = parseCodexSessionOpenInput(input);
    await openCodexSessionInTerminal(parsed);
    return { ok: true, mode: 'terminal' } satisfies CodexSessionOpenResult;
  });
  options.ipcMain.handle(DESKTOP_IPC_CHANNELS.appQuit, async () => {
    // renderer 主动退出走 coordinator，与 before-quit / window-all-closed 共用同一份清理。
    // 清理完成后用 app.exit(0) 直接结束；如果这里再走 quit 事件，before-quit 会被
    // preventDefault 兜住并因 hasStarted 短路，导致"清理完但应用没退"。
    await options.shutdown.run('ipc-app-quit');
    options.app.exit(0);
    return { ok: true };
  });
  options.ipcMain.handle(DESKTOP_IPC_CHANNELS.persistUiHint, async (_event, input: unknown) => {
    // renderer 拿到 daemon 真实 ui-preferences 后 fire-and-forget 调这里。
    // sanitize 把字段筛回 UiHint 白名单（last_opened_conversation_id / llm.* 等
    // 业务态被丢弃），写失败也不抛——丢一次 hint 等价于"用户上次没改主题"，
    // daemon 仍是真值，下一次启动 default 兜底，不会出现持久化半残状态。
    const hint = sanitizeUiHint(input);
    if (hint === null) {
      return { ok: false as const };
    }
    try {
      await options.uiHintStore.write(hint);
      return { ok: true as const };
    } catch (error) {
      console.warn(`[linnsy electron] persist ui hint failed: ${String(error)}`);
      return { ok: false as const };
    }
  });
}

function parseChannelInvokeInput(input: unknown): { channelId: string; action: unknown } {
  if (!isRecord(input) || typeof input.channelId !== 'string') {
    throw new Error('invalid desktop channel invoke input');
  }
  return {
    channelId: input.channelId,
    action: input.action
  };
}

function parseCodexSessionOpenInput(input: unknown): CodexSessionOpenInput {
  if (!isRecord(input) || typeof input.sessionId !== 'string' || input.sessionId.trim().length === 0) {
    throw new Error('invalid codex session open input');
  }
  const result: CodexSessionOpenInput = {
    sessionId: input.sessionId.trim()
  };
  if (typeof input.cwd === 'string' && input.cwd.trim().length > 0) {
    result.cwd = input.cwd.trim();
  }
  return result;
}

async function openCodexSessionInTerminal(input: CodexSessionOpenInput): Promise<void> {
  if (process.platform === 'darwin') {
    const command = buildPosixCodexResumeShellCommand(input);
    await spawnDetached('osascript', [
      '-e', 'tell application "Terminal"',
      '-e', `do script ${JSON.stringify(command)}`,
      '-e', 'activate',
      '-e', 'end tell'
    ]);
    return;
  }
  if (process.platform === 'win32') {
    const command = buildWindowsCodexResumeShellCommand(input);
    await spawnDetached('cmd.exe', ['/c', 'start', '', 'cmd.exe', '/k', command]);
    return;
  }
  await spawnDetached('x-terminal-emulator', ['-e', 'sh', '-lc', buildPosixCodexResumeShellCommand(input)]);
}

function buildPosixCodexResumeShellCommand(input: CodexSessionOpenInput): string {
  const resume = `codex resume --include-non-interactive ${shellQuote(input.sessionId)}`;
  return input.cwd === undefined ? resume : `cd ${shellQuote(input.cwd)} && ${resume}`;
}

function buildWindowsCodexResumeShellCommand(input: CodexSessionOpenInput): string {
  const resume = `codex resume --include-non-interactive ${cmdQuote(input.sessionId)}`;
  return input.cwd === undefined ? resume : `cd /d ${cmdQuote(input.cwd)} && ${resume}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function cmdQuote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function spawnDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore'
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
