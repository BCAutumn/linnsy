// @vitest-environment happy-dom

import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { DaemonDesktopStatus } from '../../lib/desktop-bridge.js';
import type { ChannelDesktopStatus } from '@renderer/contracts';

import {
  desktopBridge,
  renderApp
} from './app-shell-test-support.js';

describe('AppShell', () => {
  it('shows a desktop daemon status banner when the sidecar exits', async () => {
    let daemonListener: ((status: DaemonDesktopStatus) => void) | null = null;
    window.linnsyDesktop = desktopBridge({
      onDaemonStatusChanged: vi.fn((listener: (status: DaemonDesktopStatus) => void) => {
        daemonListener = listener;
        return () => {
          daemonListener = null;
        };
      })
    });
    const container = await renderApp('/chat');

    await act(async () => {
      daemonListener?.({
        lifecycle: 'failed',
        running: false,
        exitCode: 1
      });
      await Promise.resolve();
    });

    expect(container.innerHTML).toContain('后台服务异常退出');
    expect(container.innerHTML).toContain('exitCode=1');
  });

  it('renders the WeChat topbar as disconnected when the service is running but the phone terminal is not connected', async () => {
    window.linnsyDesktop = desktopBridge({
      listChannels: vi.fn(() => Promise.resolve([
        { channelId: 'wechat', lifecycle: 'starting' as const, autoConnect: false }
      ]))
    });

    const container = await renderApp('/chat');

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.innerHTML).toContain('正在连接');
    expect(container.innerHTML).not.toContain('微信已连接');
  });

  it('renders awaiting login as terminal disconnected in the topbar', async () => {
    window.linnsyDesktop = desktopBridge({
      listChannels: vi.fn(() => Promise.resolve([
        {
          channelId: 'wechat',
          lifecycle: 'awaiting_login' as const,
          autoConnect: false,
          loginHint: { kind: 'qr' as const, url: 'https://example.com/wechat-qr' }
        }
      ]))
    });

    const container = await renderApp('/chat');

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.innerHTML).toContain('终端未连接');
    expect(container.innerHTML).not.toContain('等待扫码');
  });

  it('renders the WeChat topbar as connected only when the phone terminal is connected', async () => {
    window.linnsyDesktop = desktopBridge({
      listChannels: vi.fn(() => Promise.resolve([
        { channelId: 'wechat', lifecycle: 'connected' as const, autoConnect: false }
      ]))
    });

    const container = await renderApp('/chat');

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.innerHTML).toContain('微信已连接');
  });

  it('renders WeChat connection controls in the terminal connections settings tab', async () => {
    const invokeChannelAction = vi.fn(() => Promise.resolve({
      channelId: 'wechat',
      lifecycle: 'awaiting_login' as const,
      autoConnect: false,
      loginHint: { kind: 'qr' as const, url: 'https://example.com/wechat-qr' }
    }));
    window.linnsyDesktop = desktopBridge({ invokeChannelAction });
    const container = await renderApp('/settings');
    const channelsButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.includes('终端连接'));
    if (channelsButton === undefined) {
      throw new Error('channels tab should render');
    }

    await act(async () => {
      channelsButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.innerHTML).toContain('终端未连接');
    expect(container.innerHTML).toContain('微信');
    expect(container.innerHTML).toContain('飞书');
    expect(container.innerHTML).toContain('Telegram');
    expect(container.innerHTML).toContain('Discord');
    expect(container.innerHTML).toContain('暂未支持');
    expect(container.querySelector('.field-desc .conn-dot--offline')).not.toBeNull();
    const connectButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.includes('查看二维码'));
    if (connectButton === undefined) {
      throw new Error('connect button should render');
    }

    await act(async () => {
      connectButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(invokeChannelAction).toHaveBeenCalledWith({
      channelId: 'wechat',
      action: { type: 'request-qr-code' }
    });
    expect(container.innerHTML).not.toContain('正在生成微信扫码二维码');
  });

  it('opens a fresh QR scanner from the view QR action', async () => {
    const invokeChannelAction = vi.fn(() => Promise.resolve({
      channelId: 'wechat',
      lifecycle: 'awaiting_login' as const,
      autoConnect: false,
      loginHint: { kind: 'qr' as const, url: 'https://example.com/wechat-qr', expiresAt: Date.now() + 120_000 }
    }));
    window.linnsyDesktop = desktopBridge({
      listChannels: vi.fn(() => Promise.resolve([
        {
          channelId: 'wechat',
          lifecycle: 'awaiting_login' as const,
          autoConnect: false,
          loginHint: { kind: 'qr' as const, url: 'https://example.com/wechat-qr' }
        }
      ])),
      invokeChannelAction
    });
    const container = await renderApp('/settings');
    const channelsButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.includes('终端连接'));
    if (channelsButton === undefined) {
      throw new Error('channels tab should render');
    }

    await act(async () => {
      channelsButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.innerHTML).toContain('查看二维码');
    expect(container.innerHTML).not.toContain('二维码已准备好，用微信扫码后会自动完成连接。');
    expect(container.innerHTML).toContain('自动连接');
    expect(container.innerHTML).toContain('飞书');
    expect(container.innerHTML).toContain('Telegram');
    expect(container.innerHTML).toContain('Discord');
    expect(container.innerHTML).toContain('暂未支持');
    expect(Array.from(container.querySelectorAll('button'))
      .some((button) => button.textContent.includes('连接手机终端'))).toBe(false);
    const qrButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.includes('查看二维码'));
    if (qrButton === undefined) {
      throw new Error('QR opener should render');
    }

    await act(async () => {
      qrButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.innerHTML).toContain('微信扫码连接');
    expect(container.innerHTML).toContain('打开微信，扫描二维码。');
    expect(container.innerHTML).not.toContain('扫码完成后，这里会自动更新连接状态。');
    const qrImage = container.querySelector('.wechat-qr-image');
    if (!(qrImage instanceof HTMLImageElement)) {
      throw new Error('QR image should render in dialog');
    }
    expect(qrImage.src.startsWith('data:image/svg+xml,')).toBe(true);
    expect(invokeChannelAction).toHaveBeenCalledWith({
      channelId: 'wechat',
      action: { type: 'request-qr-code' }
    });
  });

  it('confirms before deleting the saved WeChat account and returns to QR login', async () => {
    const invokeChannelAction = vi.fn(() => Promise.resolve({
      channelId: 'wechat',
      lifecycle: 'starting' as const,
      autoConnect: false
    }));
    let statusListener: ((status: ChannelDesktopStatus) => void) | null = null;
    window.linnsyDesktop = desktopBridge({
      listChannels: vi.fn(() => Promise.resolve([
        { channelId: 'wechat', lifecycle: 'connected' as const, autoConnect: false }
      ])),
      invokeChannelAction,
      onChannelStatusChanged: vi.fn((listener: (status: ChannelDesktopStatus) => void) => {
        statusListener = listener;
        return () => {};
      })
    });
    const container = await renderApp('/settings');
    const channelsButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.includes('终端连接'));
    if (channelsButton === undefined) {
      throw new Error('channels tab should render');
    }

    await act(async () => {
      channelsButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const deleteButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.includes('删除账号'));
    if (deleteButton === undefined) {
      throw new Error('delete account button should render');
    }
    expect(deleteButton.className).toContain('secondary-danger');

    await act(async () => {
      deleteButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.innerHTML).toContain('删除当前微信账号？');
    expect(container.innerHTML).toContain('删除后会清掉本机保存的微信登录态。需要重新连接时，再点击查看二维码。');
    expect(container.innerHTML).not.toContain('扫码完成后，Linnsy 会连接到新的手机终端。');
    expect(container.querySelector('.field-desc .conn-dot--online')).not.toBeNull();
    expect(invokeChannelAction).not.toHaveBeenCalled();
    const disconnectButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.includes('断开连接'));
    if (disconnectButton === undefined) {
      throw new Error('disconnect button should render');
    }
    expect(disconnectButton.className).toContain('primary-neutral');
    const confirmButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.includes('删除并重新扫码'));
    if (confirmButton === undefined) {
      throw new Error('delete confirmation button should render');
    }
    expect(confirmButton.className).toContain('primary-danger');

    await act(async () => {
      confirmButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(invokeChannelAction).toHaveBeenCalledWith({
      channelId: 'wechat',
      action: { type: 'delete-account' }
    });
    await act(async () => {
      statusListener?.({
        channelId: 'wechat',
        lifecycle: 'starting',
        autoConnect: false
      });
      await Promise.resolve();
    });

    expect(container.innerHTML).toContain('正在连接');
    expect(container.innerHTML).not.toContain('断开连接');
    expect(container.innerHTML).not.toContain('删除账号');
    expect(container.innerHTML).toContain('自动连接');
    expect(container.innerHTML).toContain('飞书');
    expect(container.innerHTML).toContain('Telegram');
    expect(container.innerHTML).toContain('Discord');
    expect(container.innerHTML).toContain('暂未支持');
  });
});
