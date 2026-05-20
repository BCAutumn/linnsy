import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

import { createTokenFixtureHtml, readActionButtonSnapshot } from './scenarios/theme-token-cascade-support.js';

describe('renderer theme token cascade', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser.close();
  }, 30_000);

  beforeEach(async () => {
    page = await browser.newPage();
    await page.setContent(createTokenFixtureHtml());
  });

  afterEach(async () => {
    await page.close();
  });

  it('deepens the selected conversation more button without switching to the primary action color', async () => {
    await page.locator('.conv-more-active-hover-fixture').hover();
    const snapshot = await page.evaluate(() => {
      const readElement = (selector: string): Element => {
        const element = document.querySelector(selector);
        if (element === null) {
          throw new Error(`Missing fixture element: ${selector}`);
        }
        return element;
      };
      const expectedButtonHover = document.createElement('div');
      const expectedButtonColor = document.createElement('div');
      const primaryButtonHover = document.createElement('div');
      expectedButtonHover.style.background = 'color-mix(in srgb, var(--color-primary-soft-hover) 82%, var(--color-primary) 18%)';
      expectedButtonColor.style.color = 'var(--color-fg)';
      primaryButtonHover.style.background = 'var(--color-primary)';
      readElement('.linnsy-window').append(expectedButtonHover, expectedButtonColor, primaryButtonHover);
      return {
        buttonHoverBackground: getComputedStyle(readElement('.conv-more-active-hover-fixture')).backgroundColor,
        buttonHoverColor: getComputedStyle(readElement('.conv-more-active-hover-fixture')).color,
        expectedButtonHoverBackground: getComputedStyle(expectedButtonHover).backgroundColor,
        expectedButtonHoverColor: getComputedStyle(expectedButtonColor).color,
        primaryButtonHoverBackground: getComputedStyle(primaryButtonHover).backgroundColor
      };
    });

    expect(snapshot.buttonHoverBackground).toBe(snapshot.expectedButtonHoverBackground);
    expect(snapshot.buttonHoverBackground).not.toBe(snapshot.primaryButtonHoverBackground);
    expect(snapshot.buttonHoverColor).toBe(snapshot.expectedButtonHoverColor);
  });

  it('keeps the rename conversation dialog compact with a sunken text field', async () => {
    const snapshot = await page.evaluate(() => {
      const readElement = (selector: string): Element => {
        const element = document.querySelector(selector);
        if (element === null) {
          throw new Error(`Missing fixture element: ${selector}`);
        }
        return element;
      };
      const expectedInputBackground = document.createElement('div');
      expectedInputBackground.style.background = 'var(--color-bg-sunken)';
      readElement('.linnsy-window').append(expectedInputBackground);
      return {
        dialogWidth: getComputedStyle(readElement('.conversation-rename-dialog')).width,
        footerActionJustifySelf: getComputedStyle(readElement('.conversation-rename-dialog .app-dialog-footer > .action-buttons-container')).justifySelf,
        footerActionGridColumnStart: getComputedStyle(readElement('.conversation-rename-dialog .app-dialog-footer > .action-buttons-container')).gridColumnStart,
        footerActionGridColumnEnd: getComputedStyle(readElement('.conversation-rename-dialog .app-dialog-footer > .action-buttons-container')).gridColumnEnd,
        fieldBackground: getComputedStyle(readElement('.conversation-rename-field .text-field-control')).backgroundColor,
        expectedInputBackground: getComputedStyle(expectedInputBackground).backgroundColor
      };
    });

    expect(snapshot.dialogWidth).toBe('280px');
    expect(snapshot.footerActionJustifySelf).toBe('end');
    expect(snapshot.footerActionGridColumnStart).toBe('1');
    expect(snapshot.footerActionGridColumnEnd).toBe('-1');
    expect(snapshot.fieldBackground).toBe(snapshot.expectedInputBackground);
  });

  it('uses separate dark-mode colors for danger and neutral action buttons', async () => {
    const light = await readActionButtonSnapshot(page, 'light');
    const dark = await readActionButtonSnapshot(page, 'dark');

    expect(light.dangerBackground).not.toBe(dark.dangerBackground);
    expect(light.neutralBackground).not.toBe(dark.neutralBackground);
    expect(light.dangerBackground).toBe('rgb(229, 65, 75)');
    expect(dark.dangerBackground).toBe('rgb(143, 48, 56)');
    expect(dark.dangerColor).toBe('rgb(247, 241, 242)');
    expect(dark.neutralBackground).toBe('rgb(33, 42, 47)');
    expect(dark.neutralColor).toBe('rgb(213, 220, 221)');
  });

  it('keeps the decorated composer transparent while the message layer owns the clip', async () => {
    await page.locator('.linnsy-window').evaluate((element) => {
      element.setAttribute('data-theme', 'bamboo_ash');
      element.setAttribute('data-screen', 'chat');
    });

    const snapshot = await page.evaluate(() => {
      const chatView = document.querySelector('.chat-view');
      const composerWrap = document.querySelector('.composer-wrap');
      const messageList = document.querySelector('.message-list');
      if (chatView === null || composerWrap === null || messageList === null) {
        throw new Error('Missing chat fixture');
      }

      return {
        chatViewBackground: getComputedStyle(chatView).backgroundColor,
        chatViewOverflowY: getComputedStyle(chatView).overflowY,
        messageListClipEntryDepth: getComputedStyle(messageList).getPropertyValue('--message-list-clip-entry-depth').trim(),
        messageListClipPath: getComputedStyle(messageList).clipPath,
        composerWrapBackground: getComputedStyle(composerWrap).backgroundColor,
        composerWrapPaddingTop: getComputedStyle(composerWrap).paddingTop,
        composerWrapPosition: getComputedStyle(composerWrap).position
      };
    });

    // chat-view 继续是主滚动区；底部透明露出壁纸，消息层自己裁剪掉输入区背后的文字。
    expect(snapshot.chatViewBackground).toBe('rgba(0, 0, 0, 0)');
    expect(snapshot.chatViewOverflowY).toBe('auto');
    expect(snapshot.messageListClipEntryDepth).toBe('10px');
    expect(snapshot.messageListClipPath).toBe('inset(0px 0px 24px)');
    expect(snapshot.composerWrapBackground).toBe('rgba(0, 0, 0, 0)');
    expect(snapshot.composerWrapPaddingTop).toBe('0px');
    expect(snapshot.composerWrapPosition).toBe('sticky');
  });

  it('keeps the app shell columns driven by the sidebar width variable at the minimum window width', async () => {
    await page.setViewportSize({ width: 900, height: 720 });

    const snapshots: Array<{
      requestedWidth: number;
      gridTemplateColumns: string;
      sidebarWidth: number;
      mainWidth: number;
      mainLeft: number;
      sidebarRight: number;
    }> = [];
    for (const sidebarWidth of [200, 360]) {
      await page.locator('.linnsy-window').evaluate((element, width) => {
        element.setAttribute('style', `--sidebar-width: ${String(width)}px`);
      }, sidebarWidth);
      snapshots.push(await page.evaluate((requestedWidth) => {
        const shell = document.querySelector('.linnsy-window');
        const sidebar = document.querySelector('.linnsy-sidebar');
        const main = document.querySelector('.main-wrap');
        if (shell === null || sidebar === null || main === null) {
          throw new Error('Missing shell layout fixture');
        }
        const sidebarRect = sidebar.getBoundingClientRect();
        const mainRect = main.getBoundingClientRect();
        return {
          requestedWidth,
          gridTemplateColumns: getComputedStyle(shell).gridTemplateColumns,
          sidebarWidth: Math.round(sidebarRect.width),
          mainWidth: Math.round(mainRect.width),
          mainLeft: Math.round(mainRect.left),
          sidebarRight: Math.round(sidebarRect.right)
        };
      }, sidebarWidth));
    }

    expect(snapshots).toEqual([
      {
        requestedWidth: 200,
        gridTemplateColumns: '200px 700px',
        sidebarWidth: 200,
        mainWidth: 700,
        mainLeft: 200,
        sidebarRight: 200
      },
      {
        requestedWidth: 360,
        gridTemplateColumns: '360px 540px',
        sidebarWidth: 360,
        mainWidth: 540,
        mainLeft: 360,
        sidebarRight: 360
      }
    ]);
  });

  it('lets the settings range control shrink before squeezing the setting label vertically', async () => {
    await page.setViewportSize({ width: 900, height: 720 });
    await page.locator('.linnsy-window').evaluate((element) => {
      element.setAttribute('style', '--sidebar-width: 360px');
    });

    const snapshot = await page.evaluate(() => {
      const main = document.querySelector('.main-wrap');
      if (main === null) {
        throw new Error('Missing main fixture');
      }
      const settingsView = document.createElement('section');
      settingsView.className = 'settings-view';
      settingsView.innerHTML = `
        <div class="settings-shell">
          <div class="setting-row">
            <div class="field-info">
              <div class="field-label">侧边栏宽度</div>
              <div class="field-desc">当前 260 像素，范围 200 到 360。</div>
            </div>
            <div class="settings-range-control">
              <span class="settings-range-value">260px</span>
              <div class="settings-range-wrapper">
                <input class="settings-range-input" type="range" min="200" max="360" value="260" />
                <div class="settings-range-labels" aria-hidden="true"><span>窄</span><span>宽</span></div>
              </div>
            </div>
          </div>
        </div>
      `;
      main.append(settingsView);

      const row = settingsView.querySelector('.setting-row');
      const fieldInfo = settingsView.querySelector('.field-info');
      const label = settingsView.querySelector('.field-label');
      const rangeControl = settingsView.querySelector('.settings-range-control');
      const rangeWrapper = settingsView.querySelector('.settings-range-wrapper');
      if (row === null || fieldInfo === null || label === null || rangeControl === null || rangeWrapper === null) {
        throw new Error('Missing settings range fixture');
      }
      const rectOf = (element: Element): { width: number; height: number } => {
        const rect = element.getBoundingClientRect();
        return {
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        };
      };
      return {
        row: rectOf(row),
        fieldInfo: rectOf(fieldInfo),
        label: rectOf(label),
        rangeControl: rectOf(rangeControl),
        rangeWrapper: rectOf(rangeWrapper),
        rangeFlexBasis: getComputedStyle(rangeControl).flexBasis
      };
    });

    expect(snapshot.rangeControl.width).toBeLessThanOrEqual(260);
    expect(snapshot.rangeWrapper.width).toBeGreaterThanOrEqual(96);
    expect(snapshot.fieldInfo.width).toBeGreaterThanOrEqual(220);
    expect(snapshot.label.height).toBeLessThanOrEqual(22);
    expect(snapshot.rangeFlexBasis).toBe('220px');
  });

  it('uses the bamboo wallpaper layer on scheduled view', async () => {
    await page.locator('.linnsy-window').evaluate((element) => {
      element.setAttribute('data-theme', 'bamboo_ash');
      element.setAttribute('data-screen', 'scheduled');
    });

    const snapshot = await page.evaluate(() => {
      const mainWrap = document.querySelector('.main-wrap');
      const scheduledView = document.querySelector('.scheduled-view');
      if (mainWrap === null || scheduledView === null) {
        throw new Error('Missing scheduled view fixture');
      }
      const wallpaperStyle = getComputedStyle(mainWrap, '::before');

      return {
        mainPosition: getComputedStyle(mainWrap).position,
        wallpaperContent: wallpaperStyle.content,
        wallpaperMaskImage: wallpaperStyle.maskImage || wallpaperStyle.getPropertyValue('-webkit-mask-image'),
        scheduledViewBackground: getComputedStyle(scheduledView).backgroundColor,
        scheduledViewZIndex: getComputedStyle(scheduledView).zIndex
      };
    });

    expect(snapshot.mainPosition).toBe('relative');
    expect(snapshot.wallpaperContent).toBe('""');
    expect(snapshot.wallpaperMaskImage).toContain('bamboo-ash-ink.svg');
    expect(snapshot.scheduledViewBackground).toBe('rgba(0, 0, 0, 0)');
    expect(snapshot.scheduledViewZIndex).toBe('1');
  });

});
