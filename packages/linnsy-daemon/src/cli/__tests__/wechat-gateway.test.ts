import { describe, expect, test, vi } from 'vitest';
import { Command } from 'commander';

import {
  createWechatGatewayCommand,
  describeWechatQrLoginFailure,
  writeWechatQrLoginInstructions
} from '../wechat-gateway.js';

describe('createWechatGatewayCommand', () => {
  test('exposes account deletion as data cleanup instead of reconnecting', () => {
    const command = new Command('wechat-gateway');
    createWechatGatewayCommand().register(command);

    const help = command.helpInformation();
    expect(help).toContain('--delete-account');
    expect(help).not.toContain('--reconnect');
  });
});

describe('writeWechatQrLoginInstructions', () => {
  test('prints a terminal QR when the renderer is available', async () => {
    const stdout = vi.fn<(message: string) => void>();

    await writeWechatQrLoginInstructions({
      qrUrl: 'https://example.com/qr/1',
      stdout,
      renderQr: () => Promise.resolve('QR_BLOCKS')
    });

    expect(stdout.mock.calls.map(([message]) => message)).toEqual([
      'Scan this QR code with WeChat:',
      'QR_BLOCKS',
      'If the QR does not render clearly, open this URL instead:',
      'https://example.com/qr/1'
    ]);
  });

  test('falls back to printing the QR URL when terminal rendering is unavailable', async () => {
    const stdout = vi.fn<(message: string) => void>();

    await writeWechatQrLoginInstructions({
      qrUrl: 'https://example.com/qr/1',
      stdout,
      renderQr: () => Promise.resolve(null)
    });

    expect(stdout.mock.calls.map(([message]) => message)).toEqual([
      'Open this QR URL on your computer screen and scan it with WeChat:',
      'https://example.com/qr/1'
    ]);
  });
});

describe('describeWechatQrLoginFailure', () => {
  test('renders a specific message for expired QR codes', () => {
    expect(describeWechatQrLoginFailure({ connected: false, reason: 'expired' })).toBe(
      'WeChat QR login expired before it was confirmed'
    );
  });

  test('renders a specific message for login timeouts', () => {
    expect(describeWechatQrLoginFailure({ connected: false, reason: 'timeout' })).toBe(
      'WeChat QR login timed out before it was confirmed'
    );
  });
});
