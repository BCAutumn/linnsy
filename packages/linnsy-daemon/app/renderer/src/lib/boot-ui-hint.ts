import type { UiHint } from '@renderer/contracts';

import type { UiPreferences } from './daemon-api.js';
// 引入 desktop-bridge.js 是为了让其中的 `declare global` 把 window.linnsyDesktop
// 与 window.__LINNSY_BOOT__ 注入到本模块的类型空间，避免本文件内再做 cast。
import './desktop-bridge.js';

// 桌面壳启动期 UI 提示读写器（renderer 侧）。
// 读端：preload 在第一行 JS 之前同步把 last-ui-hint.json 注入 window.__LINNSY_BOOT__，
//      AppShell 初始 state 与 applyEarlyThemeMode 都从这里取，避免开屏闪烁。
// 写端：daemon 拉到真实 ui-preferences 后 fire-and-forget 调 main 持久化下次启动 hint。
//
// renderer 自身不写 localStorage / IndexedDB / cookie（docs/04 §6.2 红线），
// 持久化由 main 接管；本模块只负责"取一次 / 推一次"的薄壳，dev 浏览器无 preload
// 时所有函数安全 no-op，不影响 daemon 真值刷新主路径。详见 docs/04 §6.5。

export function readBootUiHint(): UiHint | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.__LINNSY_BOOT__?.uiHint ?? null;
}

export function writeBootUiHint(preferences: UiPreferences): void {
  if (typeof window === 'undefined') {
    return;
  }
  const desktop = window.linnsyDesktop;
  if (desktop?.persistUiHint === undefined) {
    return;
  }
  // fire-and-forget：写失败不影响 daemon 真值刷新主路径，丢一次 hint 等价于
  // "用户上次没改主题"，下一次启动 default 兜底，不会出现持久化半残状态。
  void desktop.persistUiHint(toHint(preferences)).catch(() => {
    // ipc 通道异常（main 退出 / handler 移除）静默吞掉。
  });
}

function toHint(preferences: UiPreferences): UiHint {
  return {
    'theme.mode': preferences['theme.mode'],
    'theme.primary_color': preferences['theme.primary_color'],
    'font.size': preferences['font.size'],
    'sidebar.width_px': preferences['sidebar.width_px'],
    'sidebar.archived_collapsed': preferences['sidebar.archived_collapsed'],
    language: preferences.language
  };
}
