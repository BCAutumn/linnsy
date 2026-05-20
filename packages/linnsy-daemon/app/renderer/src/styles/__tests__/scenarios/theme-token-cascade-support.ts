import { readFileSync } from 'node:fs';

import type { Page } from 'playwright';

const rendererStyleFiles = [
  '../../tokens.css',
  '../../themes.css',
  '../../base.css',
  '../../layout.css',
  '../../sidebar.css',
  '../../chat.css',
  '../../custom-select.css',
  '../../text-field.css',
  '../../app-dialog.css',
  '../../settings-range.css',
  '../../settings.css',
  '../../onboarding.css',
  '../../theme-decorations.css'
];


export interface TokenSnapshot {
  primarySoft: string;
  primaryStrong: string;
  surfaceSelected: string;
  primaryHover: string;
  bgElevated: string;
  bgFloating: string;
  activeConversationBackground: string;
  selectedOptionBackground: string;
  userBubbleBackground: string;
  composerBackground: string;
}

export interface ActionButtonSnapshot {
  dangerBackground: string;
  dangerColor: string;
  neutralBackground: string;
  neutralColor: string;
}

export function createTokenFixtureHtml(): string {
  const css = rendererStyleFiles
    .map((filePath) => readFileSync(new URL(filePath, import.meta.url), 'utf8'))
    .join('\n');

	return `<!doctype html>
	<meta charset="utf-8">
	<style>${css}</style>
	<style>*, *::before, *::after { transition: none !important; }</style>
	<div class="linnsy-window" data-mode="light" data-theme="distant_sky">
  <aside class="linnsy-sidebar">
    <button class="new-conv-btn" type="button">
      <span class="fluent-icon fluent-icon--add"></span>
      <span>New</span>
    </button>
    <a class="sidebar-nav-link" href="#">
      <span class="fluent-icon fluent-icon--clock"></span>
      <span>Schedule</span>
    </a>
    <div class="conv-item active selected">
      <button class="conv-item-main" type="button">
        <span class="conv-title">Active</span>
        <span class="conv-meta">
          <time class="conv-time">1分钟前</time>
        </span>
      </button>
      <button aria-expanded="false" class="conv-more-btn conv-more-active-hover-fixture" type="button">
        <span class="fluent-icon fluent-icon--moreHorizontal"></span>
      </button>
    </div>
    <div class="conv-item conv-hover-fixture">
      <button class="conv-item-main" type="button">
        <span class="conv-title">Hover target</span>
        <span class="conv-meta">
          <time class="conv-time">1分钟前</time>
        </span>
      </button>
      <button aria-expanded="false" class="conv-more-btn conv-more-hover-fixture" type="button">
        <span class="fluent-icon fluent-icon--moreHorizontal"></span>
      </button>
    </div>
  </aside>
	  <main class="main-wrap">
	    <div class="msg user"><div class="bubble">hello</div></div>
	    <button class="custom-select-option is-selected" type="button">
	      <span class="custom-select-option-icon"><span class="fluent-icon fluent-icon--edit"></span></span>
	      <span class="custom-select-option-label">Selected</span>
	    </button>
	    <button class="action-btn primary primary-danger" type="button">Danger</button>
	    <button class="action-btn primary primary-neutral" type="button">Neutral</button>
	    <section class="app-dialog app-dialog--md conversation-rename-dialog">
	      <div class="app-dialog-body">
	        <div class="text-field conversation-rename-field">
	          <span class="text-field-label">名称</span>
	          <span class="text-field-control"><input aria-label="名称" id="rename-fixture" value="Active" /></span>
	        </div>
	      </div>
	      <footer class="app-dialog-footer">
	        <div class="action-buttons-container action-buttons-container--sm">
	          <button class="action-btn secondary secondary-ghost" type="button">取消</button>
	          <button class="action-btn primary" type="button">保存</button>
	        </div>
	      </footer>
	    </section>
	    <div class="seg-control"><button type="button">x</button></div>
	    <section class="chat-view scroll-area">
	      <article class="message-list" style="--message-list-clip-bottom: 24px">
	        <div class="msg assistant">reply</div>
	      </article>
	      <div class="composer-wrap">
	        <form class="composer"><textarea>x</textarea></form>
	      </div>
	    </section>
	    <section class="scheduled-view scroll-area">
	      <div class="scheduled-view-shell">Scheduled</div>
	    </section>
	  </main>
	</div>`;
}

export async function readTokenSnapshot(page: Page, theme: string): Promise<TokenSnapshot> {
  await page.locator('.linnsy-window').evaluate((element, nextTheme) => {
    element.setAttribute('data-theme', nextTheme);
  }, theme);

  return page.evaluate(() => {
    const readElement = (selector: string): Element => {
      const element = document.querySelector(selector);
      if (element === null) {
        throw new Error(`Missing fixture element: ${selector}`);
      }
      return element;
    };
    const readCssToken = (style: CSSStyleDeclaration, name: string): string => (
      style.getPropertyValue(name).trim()
    );

    const windowElement = readElement('.linnsy-window');
    const windowStyle = getComputedStyle(windowElement);

    return {
      primarySoft: readCssToken(windowStyle, '--color-primary-soft'),
      primaryStrong: readCssToken(windowStyle, '--color-primary-strong'),
      surfaceSelected: readCssToken(windowStyle, '--color-surface-selected'),
      primaryHover: readCssToken(windowStyle, '--color-primary-hover'),
      bgElevated: readCssToken(windowStyle, '--color-bg-elevated'),
      bgFloating: readCssToken(windowStyle, '--color-bg-floating'),
      activeConversationBackground: getComputedStyle(readElement('.conv-item.active')).backgroundColor,
      selectedOptionBackground: getComputedStyle(readElement('.custom-select-option.is-selected')).backgroundColor,
      userBubbleBackground: getComputedStyle(readElement('.msg.user .bubble')).backgroundColor,
      composerBackground: getComputedStyle(readElement('.composer')).backgroundColor
    };
	  });
	}

export async function readActionButtonSnapshot(page: Page, mode: 'light' | 'dark'): Promise<ActionButtonSnapshot> {
  await page.locator('.linnsy-window').evaluate((element, nextMode) => {
    element.setAttribute('data-mode', nextMode);
  }, mode);

  return page.evaluate(() => {
    const readElement = (selector: string): Element => {
      const element = document.querySelector(selector);
      if (element === null) {
        throw new Error(`Missing fixture element: ${selector}`);
      }
      return element;
    };
    const dangerStyle = getComputedStyle(readElement('.primary-danger'));
    const neutralStyle = getComputedStyle(readElement('.primary-neutral'));
    return {
      dangerBackground: dangerStyle.backgroundColor,
      dangerColor: dangerStyle.color,
      neutralBackground: neutralStyle.backgroundColor,
      neutralColor: neutralStyle.color
    };
  });
}
