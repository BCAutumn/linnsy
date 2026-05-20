import { describe, expect, test } from 'vitest';

import {
  parseAutostartGetResult,
  parseCodexSessionOpenResult,
  parseDesktopApiConfig,
  parseOkTrueResult
} from '../../electron/ipc-contract.js';
import {
  parseChannelDesktopAction,
  parseChannelDesktopStatus,
  parseChannelDesktopStatusList
} from '../../src/domains/desktop-integration/definitions/desktop-channel-contract.js';
import { parseDaemonDesktopStatus } from '../../src/domains/desktop-integration/definitions/desktop-daemon-contract.js';

describe('desktop IPC runtime contracts', () => {
  test('accepts valid desktop IPC payloads', () => {
    expect(parseDesktopApiConfig({
      baseUrl: 'http://127.0.0.1:4321',
      bearerToken: 'secret'
    })).toEqual({
      baseUrl: 'http://127.0.0.1:4321',
      bearerToken: 'secret'
    });
    expect(parseDaemonDesktopStatus({ lifecycle: 'running', running: true })).toEqual({
      lifecycle: 'running',
      running: true
    });
    expect(parseChannelDesktopStatus({
      channelId: 'wechat',
      lifecycle: 'awaiting_login',
      autoConnect: true,
      loginHint: {
        kind: 'qr',
        url: 'https://example.com/qr',
        expiresAt: 123
      }
    })).toMatchObject({ channelId: 'wechat', lifecycle: 'awaiting_login' });
    expect(parseChannelDesktopAction({ type: 'set-auto-connect', enabled: false })).toEqual({
      type: 'set-auto-connect',
      enabled: false
    });
    expect(parseAutostartGetResult({ enabled: true })).toEqual({ enabled: true });
    expect(parseCodexSessionOpenResult({ ok: true, mode: 'terminal' })).toEqual({ ok: true, mode: 'terminal' });
    expect(parseOkTrueResult({ ok: true })).toEqual({ ok: true });
  });

  test('rejects malformed payloads before they reach renderer state', () => {
    expect(() => parseDesktopApiConfig({
      baseUrl: 'http://127.0.0.1:4321'
    })).toThrow();
    expect(() => parseDaemonDesktopStatus({
      lifecycle: 'running',
      running: true,
      unexpected: true
    })).toThrow();
    expect(() => parseChannelDesktopStatusList([
      { channelId: 'wechat', lifecycle: 'connected', autoConnect: true },
      { channelId: 'telegram', lifecycle: 'unknown', autoConnect: true }
    ])).toThrow();
    expect(() => parseChannelDesktopAction({ type: 'set-auto-connect' })).toThrow();
  });
});
