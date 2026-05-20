// @vitest-environment happy-dom

import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { DaemonApiClient } from '../../lib/daemon-api.js';

import {
  daemonClient,
  preferences,
  renderApp,
  setInputValue
} from './app-shell-test-support.js';

describe('AppShell', () => {
  it('renders settings with general language controls and the configured tab list', async () => {
    const container = await renderApp('/settings');
    const html = container.innerHTML;

    expect(html).toContain('aria-label="设置"');
    expect(html).toContain('返回');
    expect(html).toContain('常规');
    expect(html).toContain('语言');
    expect(html).toContain('外观');
    expect(html).toContain('模型');
    expect(html).toContain('记忆');
    expect(html).toContain('终端连接');
    expect(html).toContain('应用连接');
    expect(html).not.toContain('通知');
    expect(html).not.toContain('高级');
    expect(html).not.toContain('隐私');
    expect(html).not.toContain('系统');
    expect(html).not.toContain('工具');
    const tabLabels = Array.from(container.querySelectorAll('.settings-tabs-nav .tab-btn'))
      .map((button) => button.textContent.trim());
    expect(tabLabels).toEqual(['常规', '外观', '模型', '记忆', '终端连接', '应用连接']);
    expect(container.querySelector('.sidebar-bottom')).toBeNull();
    expect(container.querySelector('.settings-kicker')).toBeNull();
  });

  it('renders application connection placeholders for external coding apps', async () => {
    const container = await renderApp('/settings');
    const appConnectionsButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.includes('应用连接'));
    if (appConnectionsButton === undefined) {
      throw new Error('application connections tab should render');
    }

    await act(async () => {
      appConnectionsButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.innerHTML).toContain('Codex');
    expect(container.innerHTML).toContain('检测 Codex');
    expect(container.innerHTML).toContain('未找到 Codex CLI');
    expect(container.innerHTML).toContain('自动连接');
    expect(container.innerHTML).toContain('Claude Code');
    expect(container.innerHTML).toContain('Cursor');
    expect(container.innerHTML).toContain('暂未支持');
    const codexConnectButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.includes('检测 Codex'));
    expect(codexConnectButton?.disabled).toBe(false);
    const autoConnectSwitch = container.querySelector('.application-connection-group--codex .toggle-switch');
    expect(autoConnectSwitch?.hasAttribute('disabled')).toBe(true);
  });

  it('refreshes Codex connection state from the application connections tab', async () => {
    const probeCodexConnection = vi.fn<DaemonApiClient['probeCodexConnection']>(() => Promise.resolve({
      status: 'available',
      command: 'codex',
      checkedAt: 2,
      version: 'codex-cli 1.2.3'
    }));
    const container = await renderApp('/settings', daemonClient({ probeCodexConnection }));
    const appConnectionsButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.includes('应用连接'));
    if (appConnectionsButton === undefined) {
      throw new Error('application connections tab should render');
    }

    await act(async () => {
      appConnectionsButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    const codexConnectButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.includes('检测 Codex'));
    if (codexConnectButton === undefined) {
      throw new Error('codex connect button should render');
    }

    await act(async () => {
      codexConnectButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(probeCodexConnection).toHaveBeenCalledTimes(1);
    expect(container.innerHTML).toContain('Codex CLI 可用 · codex-cli 1.2.3');
  });

  it('renders model settings and saves a custom chat model', async () => {
    const saveModelSettings = vi.fn<DaemonApiClient['saveModelSettings']>((input) => Promise.resolve({
      chatModelId: input.chatModelId,
      models: [
        ...input.userModels.map((model) => ({
          id: `user.${model.id}`,
          provider: `user_${model.providerType}_${model.id}`,
          apiProtocol: model.providerType === 'openai_compatible' ? 'openai_chat' : 'anthropic_messages',
          modelName: model.modelName,
          ...(model.displayName === undefined ? {} : { displayName: model.displayName }),
          baseUrl: model.baseUrl,
          source: 'user' as const,
          hasApiKey: model.apiKey !== undefined
        }))
      ],
      userModels: input.userModels.map((model) => ({ ...model, hasApiKey: model.apiKey !== undefined }))
    }));
    const container = await renderApp('/settings', daemonClient({ saveModelSettings }));
    const modelsButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.includes('模型'));
    if (modelsButton === undefined) {
      throw new Error('models tab should render');
    }

    await act(async () => {
      modelsButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const openAddButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.trim() === '添加');
    if (openAddButton === undefined) {
      throw new Error('add model button should render');
    }

    await act(async () => {
      openAddButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const dialog = container.querySelector<HTMLElement>('.model-dialog');
    if (dialog === null) {
      throw new Error('model dialog should render');
    }
    const inputs = Array.from(dialog.querySelectorAll<HTMLInputElement>('.model-form-grid input'));
    const urlInput = inputs[0];
    const nameInput = inputs[1];
    const apiKeyInput = inputs[2];
    const displayInput = inputs[3];
    const revealButton = dialog.querySelector<HTMLButtonElement>('.text-field-icon-button');
    const addButton = Array.from(dialog.querySelectorAll('button'))
      .find((button) => button.textContent.trim() === '添加');
    if (urlInput === undefined || nameInput === undefined || apiKeyInput === undefined || displayInput === undefined || addButton === undefined || revealButton === null) {
      throw new Error('model form should render');
    }
    expect(apiKeyInput.type).toBe('password');

    await act(async () => {
      revealButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(apiKeyInput.type).toBe('text');

    await act(async () => {
      setInputValue(urlInput, 'api.deepseek.com');
      setInputValue(nameInput, 'deepseek-chat');
      setInputValue(apiKeyInput, 'sk-test');
      setInputValue(displayInput, 'DeepSeek');
      await Promise.resolve();
    });
    await act(async () => {
      addButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const saved = saveModelSettings.mock.calls[0]?.[0];
    expect(saved?.userModels[0]).toMatchObject({
      providerType: 'openai_compatible',
      baseUrl: 'https://api.deepseek.com/v1',
      modelName: 'deepseek-chat',
      apiKey: 'sk-test',
      displayName: 'DeepSeek'
    });
    expect(container.textContent).toContain('https://api.deepseek.com/v1');
    expect(container.textContent).not.toContain('openai_chat');
    expect(container.textContent).not.toContain('deepseek-chat');
    expect(container.textContent).not.toContain('已保存。');
  });

  it('returns from settings to chat through the sidebar back link', async () => {
    const container = await renderApp('/settings');
    const backLink = Array.from(container.querySelectorAll('a'))
      .find((link) => link.textContent.includes('返回'));
    if (backLink === undefined) {
      throw new Error('settings back link should render');
    }

    await act(async () => {
      backLink.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.innerHTML).toContain('告诉 Linnsy 你要做什么');
    expect(container.innerHTML).toContain('hello from db');
  });

  it('persists language changes from the general settings tab', async () => {
    const setUiPreference = vi.fn(() => Promise.resolve());
    const container = await renderApp('/settings', daemonClient({ setUiPreference }));
    const languageTrigger = container.querySelector<HTMLButtonElement>('.custom-select-trigger');
    if (languageTrigger === null) {
      throw new Error('language select trigger should render');
    }

    await act(async () => {
      languageTrigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    const englishOption = Array.from(container.querySelectorAll<HTMLButtonElement>('.custom-select-option'))
      .find((button) => button.textContent.includes('English'));
    if (englishOption === undefined) {
      throw new Error('English option should render');
    }

    await act(async () => {
      englishOption.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await new Promise((resolve) => {
        window.setTimeout(resolve, 160);
      });
    });

    expect(setUiPreference).toHaveBeenCalledWith('language', 'en-US');
    expect(container.innerHTML).toContain('General');
  });

  it('renders the reusable settings range slider for sidebar width', async () => {
    const setUiPreference = vi.fn(() => Promise.resolve());
    const container = await renderApp('/settings', daemonClient({ setUiPreference }));
    const appearanceButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.includes('外观'));
    if (appearanceButton === undefined) {
      throw new Error('appearance tab should render');
    }

    await act(async () => {
      appearanceButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain('界面密度');
    expect(container.textContent).not.toContain('阅读密度');
    expect(container.textContent).not.toContain('字号');

    const slider = container.querySelector<HTMLInputElement>('.settings-range-input');
    if (slider === null) {
      throw new Error('sidebar width slider should render');
    }
    expect(slider.getAttribute('aria-valuetext')).toBe('260px');

    await act(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      if (descriptor === undefined || descriptor.set === undefined) {
        throw new Error('input value setter should exist');
      }
      const setRangeValue = descriptor.set.bind(slider);
      setRangeValue('300');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });

    expect(setUiPreference).toHaveBeenCalledWith('sidebar.width_px', 300);
    expect(container.querySelector('.settings-range-value')?.textContent).toBe('300px');
  });

  it('recovers when the local daemon API becomes available after the first connection failure', async () => {
    vi.useFakeTimers();
    const client = daemonClient({
      getUiPreferences: vi.fn()
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValue(preferences)
    });
    const container = await renderApp('/chat', client);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
      await Promise.resolve();
    });

    expect(container.innerHTML).toContain('未启动连接服务');
    expect(container.innerHTML).not.toContain('本机连接失败');
  });

  it('keeps retryable local daemon failures out of the global error banner', async () => {
    vi.useFakeTimers();
    const client = daemonClient({
      getUiPreferences: vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    });
    const container = await renderApp('/chat', client);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(16000);
      await Promise.resolve();
    });

    expect(container.innerHTML).toContain('未启动连接服务');
    expect(container.innerHTML).not.toContain('本机连接失败');
  });

  it('does not downgrade visible status during a transient remount after a recent connection', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    window.sessionStorage.setItem('linnsy.desktop.lastConnectedAt', '1000');
    const client = daemonClient({
      getUiPreferences: vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    });
    const container = await renderApp('/chat', client);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(16000);
      await Promise.resolve();
    });

    expect(container.innerHTML).toContain('未启动连接服务');
    expect(container.innerHTML).not.toContain('正在启动本机 Linnsy');
    expect(container.innerHTML).not.toContain('正在重连');
    expect(container.innerHTML).not.toContain('本机连接失败');
  });
});
