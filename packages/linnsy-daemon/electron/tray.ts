import { Menu, nativeImage, Tray, type BrowserWindow } from 'electron';

import type { DaemonSpawner } from './daemon-spawner.js';

export interface DesktopTray {
  destroy(): void;
}

export interface CreateDesktopTrayOptions {
  window: BrowserWindow;
  daemon: DaemonSpawner;
  requestQuit(): void;
}

export function createDesktopTray(options: CreateDesktopTrayOptions): DesktopTray {
  const tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('Linnsy');
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: '显示 Linnsy',
      click: () => {
        options.window.show();
        options.window.focus();
      }
    },
    {
      label: options.daemon.isRunning() ? '后台服务运行中' : '后台服务未启动',
      enabled: false
    },
    {
      label: '退出',
      click: () => {
        options.requestQuit();
      }
    }
  ]));

  return {
    destroy(): void {
      tray.destroy();
    }
  };
}
