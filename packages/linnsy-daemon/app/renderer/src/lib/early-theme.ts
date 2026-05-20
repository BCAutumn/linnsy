import { readBootUiHint } from './boot-ui-hint.js';
import type { ThemeMode } from './theme.js';

// 在 React mount 之前，根据 preload 同步注入的 window.__LINNSY_BOOT__ 把上次
// 的 theme.mode 应用到 document.documentElement，让 :root[data-mode="dark"]
// 兜底 token（见 styles/tokens.css）立刻生效，从而消除"白屏 → 暗色"的开屏闪烁。
//
// 这里仅 apply mode，不 apply primary_color——themes.css 用的是
// .linnsy-window[data-theme=...] 选择器，色块要在 React 第一帧 root div
// 落上 data-theme 才能生效；mode 只关心 dark/light 这两档基底色，已经
// 足以掩盖绝大多数视觉跳变。15 套主题色之间互相切换的肉眼差异远小于
// 黑白底色的差异，落在 React 第一帧也察觉不到。
export function applyEarlyThemeMode(): void {
  if (typeof document === 'undefined') {
    return;
  }
  const hint = readBootUiHint();
  const mode: ThemeMode = hint?.['theme.mode'] ?? 'auto';
  const resolved = resolveEffectiveMode(mode);
  document.documentElement.setAttribute('data-mode', resolved);
}

export function applyThemeModeNow(mode: ThemeMode): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.setAttribute('data-mode', resolveEffectiveMode(mode));
}

function resolveEffectiveMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') {
    return mode;
  }
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}
