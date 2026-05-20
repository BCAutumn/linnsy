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

import { createTokenFixtureHtml, readTokenSnapshot } from './scenarios/theme-token-cascade-support.js';

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

  it('re-derives interaction aliases from the current window theme', async () => {
    const distantSky = await readTokenSnapshot(page, 'distant_sky');
    const pineCypress = await readTokenSnapshot(page, 'pine_cypress');
    const rouge = await readTokenSnapshot(page, 'rouge');

    expect(distantSky.surfaceSelected).toBe(distantSky.primarySoft);
    expect(pineCypress.surfaceSelected).toBe(pineCypress.primarySoft);
    expect(rouge.surfaceSelected).toBe(rouge.primarySoft);
    expect(pineCypress.primaryHover).toBe(pineCypress.primaryStrong);
    expect(rouge.primaryHover).toBe(rouge.primaryStrong);

    expect(pineCypress.surfaceSelected).not.toBe(distantSky.surfaceSelected);
    expect(rouge.surfaceSelected).not.toBe(distantSky.surfaceSelected);
    expect(pineCypress.activeConversationBackground).toBe(pineCypress.userBubbleBackground);
    expect(rouge.activeConversationBackground).toBe(rouge.userBubbleBackground);
    expect(pineCypress.selectedOptionBackground).toBe(pineCypress.userBubbleBackground);
    expect(rouge.selectedOptionBackground).toBe(rouge.userBubbleBackground);

    // bg-elevated 必须跟主题色相走，防止退化回硬编码无色相白。distant_sky 通过
    // themes.css 的 --theme-bg-elevated-light slot override 为 #FAFBFC，其他 14
    // 套带色相主题走 mix(bg 60%, #FFFFFF) 公式自动派生。
    expect(rouge.bgElevated).not.toBe(distantSky.bgElevated);
    expect(pineCypress.bgElevated).not.toBe(distantSky.bgElevated);
    expect(rouge.bgElevated).not.toBe(pineCypress.bgElevated);

    // bg-floating 是悬浮式抬高（Composer / 记忆预览卡），公式 mix(bg 30%, #FFFFFF)
    // 比 elevated 更接近白。带色相主题下 floating 必须与 elevated 不同色（否则
    // "悬浮" 与 "嵌入" 两档塌成一档）；distant_sky 因为 bg 已封顶 #FFFFFF、且
    // elevated 走 slot override 为 #FAFBFC，floating 落到 #FFFFFF，两者也应不同。
    expect(rouge.bgFloating).not.toBe(rouge.bgElevated);
    expect(pineCypress.bgFloating).not.toBe(pineCypress.bgElevated);
    expect(distantSky.bgFloating).not.toBe(distantSky.bgElevated);
    expect(rouge.bgFloating).not.toBe(pineCypress.bgFloating);

    // .composer 的真实渲染背景必须等于当前主题的 bg-floating，不可被 user-agent
    // 默认或别处 css 退化为白。distant_sky 下 floating = #FFFFFF（rgb(255,255,255)）
    // 是合理的（bg 已封顶），但带色相主题（pine_cypress / rouge）下绝对不能是白。
    expect(pineCypress.composerBackground).not.toBe('rgb(255, 255, 255)');
    expect(rouge.composerBackground).not.toBe('rgb(255, 255, 255)');
    expect(pineCypress.composerBackground).not.toBe(rouge.composerBackground);
  });

  it('keeps theme-aware aliases (composer-bg / sidebar-action-color) live across mode switch', async () => {
    const rougeLight = await readTokenSnapshot(page, 'rouge');

    await page.locator('.linnsy-window').evaluate((element) => {
      element.setAttribute('data-mode', 'dark');
    });
    const dark = await page.evaluate(() => {
      const composer = document.querySelector('.composer');
      const segControl = document.querySelector('.seg-control');
      const window = document.querySelector('.linnsy-window');
      if (composer === null || segControl === null || window === null) {
        throw new Error('Missing fixture');
      }
      const windowStyle = getComputedStyle(window);
      return {
        composerBackground: getComputedStyle(composer).backgroundColor,
        segControlBackground: getComputedStyle(segControl).backgroundColor,
        sidebarAction: windowStyle.getPropertyValue('--sidebar-action-color').trim(),
        fgMuted: windowStyle.getPropertyValue('--color-fg-muted').trim(),
        segShellBg: windowStyle.getPropertyValue('--color-segmented-shell-bg').trim(),
        bgSunken: windowStyle.getPropertyValue('--color-bg-sunken').trim(),
        primary: windowStyle.getPropertyValue('--color-primary').trim(),
        themePrimaryDark: windowStyle.getPropertyValue('--theme-primary-dark').trim()
      };
    });

    // 暗色 floating 硬配为 #1B2227 = rgb(27,34,39)。这条断言锁住"--composer-bg
    // 必须在 .linnsy-window 重派生"——若有人将该别名挪回 :root，custom property
    // 会被早期替换为 :root 兜底的 #FFFFFF，dark 模式下 Composer 退化为白（实际
    // 报告过的 bug）。
    expect(dark.composerBackground).toBe('rgb(27, 34, 39)');
    expect(rougeLight.composerBackground).not.toBe(dark.composerBackground);

    // 同坑：--sidebar-action-color 必须跟 --color-fg-muted 在 mode 切换时同步。
    // dark 下 fg-muted = #8A9398；若 sidebar-action-color 留在 :root，会被早期
    // 替换为 light 的 #595959，dark 模式下侧栏图标对深色背景对比度不足。
    expect(dark.sidebarAction).toBe(dark.fgMuted);

    // dark 下 seg-control 容器 = rgba(255,255,255,0.04) alpha 白覆盖；不再沿用
    // bg-sunken（#090D10，与 bg #0D1114 仅差 4 RGB，肉眼不可分辨）。
    expect(dark.segShellBg).toBe('rgba(255, 255, 255, 0.04)');
    expect(dark.segShellBg).not.toBe(dark.bgSunken);
    expect(dark.segControlBackground).toBe('rgba(255, 255, 255, 0.04)');

    // dark 下 --color-primary 必须经 color-mix 派生压暗（兑入 22% bg-elevated），
    // 不能等于 themes.css 里的原始 --theme-primary-dark 值——后者直接用作背景填充
    // 在 dark 下普遍刺眼。若有人把派生公式改回 var(--theme-primary-dark)，断言失败。
    expect(dark.primary).not.toBe(dark.themePrimaryDark);
    expect(dark.primary).toContain('color-mix');
  });

  it('keeps compact icon rows on the same 16px line box', async () => {
    await page.locator('.conv-hover-fixture').hover();
    const snapshot = await page.evaluate(() => {
      const readElement = (selector: string): Element => {
        const element = document.querySelector(selector);
        if (element === null) {
          throw new Error(`Missing fixture element: ${selector}`);
        }
        return element;
      };
      const readStyle = (selector: string): CSSStyleDeclaration => getComputedStyle(readElement(selector));
      const expectedRowHover = document.createElement('div');
      expectedRowHover.style.background = 'var(--color-surface-hover)';
      readElement('.linnsy-window').append(expectedRowHover);
      return {
        fluentIconLineHeight: readStyle('.fluent-icon').lineHeight,
        fluentIconHeight: readStyle('.fluent-icon').height,
        fluentIconVerticalAlign: readStyle('.fluent-icon').verticalAlign,
        newConversationLineHeight: readStyle('.new-conv-btn').lineHeight,
        sidebarNavLineHeight: readStyle('.sidebar-nav-link').lineHeight,
        conversationTitleLineHeight: readStyle('.conv-hover-fixture .conv-title').lineHeight,
        conversationMainPaddingRight: readStyle('.conv-hover-fixture .conv-item-main').paddingRight,
        conversationMainHoverBackground: readStyle('.conv-hover-fixture .conv-item-main').backgroundColor,
        conversationTimeHoverOpacity: readStyle('.conv-hover-fixture .conv-time').opacity,
        conversationTimeTransitionDuration: readStyle('.conv-hover-fixture .conv-time').transitionDuration,
        conversationMoreButtonOpacity: readStyle('.conv-hover-fixture .conv-more-btn').opacity,
        conversationMoreButtonBackground: readStyle('.conv-hover-fixture .conv-more-btn').backgroundColor,
        conversationMoreButtonRadius: readStyle('.conv-hover-fixture .conv-more-btn').borderRadius,
        conversationMoreButtonTransitionDuration: readStyle('.conv-hover-fixture .conv-more-btn').transitionDuration,
        expectedRowHoverBackground: getComputedStyle(expectedRowHover).backgroundColor,
        menuOptionLineHeight: readStyle('.custom-select-option').lineHeight,
        menuIconSlotHeight: readStyle('.custom-select-option-icon').height
      };
    });

    expect(snapshot.fluentIconLineHeight).toBe('13px');
    expect(snapshot.fluentIconHeight).toBe('16px');
    expect(snapshot.fluentIconVerticalAlign).toBe('middle');
    expect(snapshot.newConversationLineHeight).toBe('16px');
    expect(snapshot.sidebarNavLineHeight).toBe('16px');
    expect(snapshot.conversationTitleLineHeight).toBe('16px');
    expect(snapshot.conversationMainPaddingRight).toBe('8px');
    expect(snapshot.conversationMainHoverBackground).toBe(snapshot.expectedRowHoverBackground);
    expect(snapshot.conversationTimeHoverOpacity).toBe('0');
    expect(snapshot.conversationTimeTransitionDuration).toBe('0s');
    expect(snapshot.conversationMoreButtonOpacity).toBe('1');
    expect(snapshot.conversationMoreButtonBackground).toBe(snapshot.expectedRowHoverBackground);
    expect(snapshot.conversationMoreButtonRadius).toBe('6px');
    expect(snapshot.conversationMoreButtonTransitionDuration).toBe('0s');
    expect(snapshot.menuOptionLineHeight).toBe('16px');
    expect(snapshot.menuIconSlotHeight).toBe('16px');
  });

  it('uses a stronger hover color on the conversation more button itself', async () => {
    await page.locator('.conv-more-hover-fixture').hover();
    const snapshot = await page.evaluate(() => {
      const readElement = (selector: string): Element => {
        const element = document.querySelector(selector);
        if (element === null) {
          throw new Error(`Missing fixture element: ${selector}`);
        }
        return element;
      };
      const expectedButtonHover = document.createElement('div');
      expectedButtonHover.style.background = 'var(--color-primary-soft-hover)';
      readElement('.linnsy-window').append(expectedButtonHover);
      return {
        buttonHoverBackground: getComputedStyle(readElement('.conv-more-hover-fixture')).backgroundColor,
        expectedButtonHoverBackground: getComputedStyle(expectedButtonHover).backgroundColor
      };
    });

    expect(snapshot.buttonHoverBackground).toBe(snapshot.expectedButtonHoverBackground);
  });

});
