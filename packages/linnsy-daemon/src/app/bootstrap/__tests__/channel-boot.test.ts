import { describe, expect, test, vi } from 'vitest';

import type { LinnsyConfig } from '../../../config/schema.js';
import { silentLogger, type LoggerPort } from '../../../shared/ports.js';

import { bootChannelAdapters } from '../channel-boot.js';
import { WECHAT_PLATFORM } from '../../../domains/channel/features/wechat/wechat-channel-adapter.js';
import { DESKTOP_PLATFORM } from '../../../domains/channel/features/desktop/desktop-channel-adapter.js';
import { CLI_PLATFORM } from '../../../domains/channel/features/cli/cli-channel-adapter.js';

describe('bootChannelAdapters', () => {
  test('boots cli channel even when no optional channels are enabled', () => {
    const result = bootChannelAdapters({
      config: configFixture(),
      logger: silentLogger,
      env: {}
    });

    expect(result.failures).toEqual([]);
    expect(result.desktopBus).toBeNull();
    expect(result.adapters.map((adapter) => adapter.platform)).toEqual([CLI_PLATFORM]);
  });

  test('does not bring down boot when wechat is enabled but bearer env is missing', () => {
    const warnings: string[] = [];
    const logger = createCapturingLogger((message) => warnings.push(message));

    const result = bootChannelAdapters({
      config: configFixture({
        wechat: {
          enabled: true,
          gateway_bind: '127.0.0.1:7788',
          gateway_base_url: 'http://127.0.0.1:7788',
          bearer_env: 'LINNSY_WECHAT_GATEWAY_BEARER',
          poll_interval_ms: 1500
        }
      }),
      logger,
      env: {}
    });

    expect(result.failures).toEqual([
      {
        channelId: 'wechat',
        reason: 'missing required environment variable LINNSY_WECHAT_GATEWAY_BEARER'
      }
    ]);
    expect(result.adapters.map((adapter) => adapter.platform)).toEqual([CLI_PLATFORM]);
    expect(warnings).toEqual([
      "wechat channel disabled at boot: missing required environment variable LINNSY_WECHAT_GATEWAY_BEARER"
    ]);
  });

  test('boots wechat adapter when bearer env is present', () => {
    const result = bootChannelAdapters({
      config: configFixture({
        wechat: {
          enabled: true,
          gateway_bind: '127.0.0.1:7788',
          gateway_base_url: 'http://127.0.0.1:7788',
          bearer_env: 'LINNSY_WECHAT_GATEWAY_BEARER',
          poll_interval_ms: 1500
        }
      }),
      logger: silentLogger,
      env: { LINNSY_WECHAT_GATEWAY_BEARER: 'dev-secret' }
    });

    expect(result.failures).toEqual([]);
    expect(result.adapters.map((adapter) => adapter.platform)).toEqual([
      CLI_PLATFORM,
      WECHAT_PLATFORM
    ]);
  });

  test('skips wechat without warning when wechat config is disabled', () => {
    const warn = vi.fn();
    const logger: LoggerPort = { ...silentLogger, warn };

    const result = bootChannelAdapters({
      config: configFixture({
        wechat: {
          enabled: false,
          gateway_bind: '127.0.0.1:7788',
          gateway_base_url: 'http://127.0.0.1:7788',
          bearer_env: 'LINNSY_WECHAT_GATEWAY_BEARER',
          poll_interval_ms: 1500
        }
      }),
      logger,
      env: {}
    });

    expect(result.failures).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    expect(result.adapters.map((adapter) => adapter.platform)).toEqual([CLI_PLATFORM]);
  });

  test('boots desktop channel and exposes desktopBus when web channel is enabled', () => {
    const result = bootChannelAdapters({
      config: configFixture({
        web: {
          enabled: true,
          bind: '127.0.0.1:7700',
          bearer_env: 'LINNSY_WEB_BEARER'
        }
      }),
      logger: silentLogger,
      env: {}
    });

    expect(result.failures).toEqual([]);
    expect(result.desktopBus).not.toBeNull();
    expect(result.adapters.map((adapter) => adapter.platform)).toEqual([
      CLI_PLATFORM,
      DESKTOP_PLATFORM
    ]);
  });

  test('keeps desktop channel alive even when wechat boot fails', () => {
    const result = bootChannelAdapters({
      config: configFixture({
        web: {
          enabled: true,
          bind: '127.0.0.1:7700',
          bearer_env: 'LINNSY_WEB_BEARER'
        },
        wechat: {
          enabled: true,
          gateway_bind: '127.0.0.1:7788',
          gateway_base_url: 'http://127.0.0.1:7788',
          bearer_env: 'LINNSY_WECHAT_GATEWAY_BEARER',
          poll_interval_ms: 1500
        }
      }),
      logger: silentLogger,
      env: {}
    });

    expect(result.failures.map((failure) => failure.channelId)).toEqual(['wechat']);
    expect(result.desktopBus).not.toBeNull();
    expect(result.adapters.map((adapter) => adapter.platform)).toEqual([
      CLI_PLATFORM,
      DESKTOP_PLATFORM
    ]);
  });
});

function configFixture(channelOverrides: Partial<LinnsyConfig['channels']> = {}): LinnsyConfig {
  return {
    profile: 'test',
    home: '/tmp/linnsy',
    llm: {
      default_provider: 'openai',
      defaults: {
        secretary: 'openai.gpt5',
        cron_summary: 'openai.gpt5',
        memory_consolidate: 'openai.gpt5'
      },
      providers: {
        openai: {
          api_protocol: 'openai_responses',
          api_key_env: 'LINNSY_OPENAI_KEY',
          models: {
            gpt5: { model_name: 'gpt-5' }
          }
        }
      }
    },
    channels: {
      cli: { enabled: true },
      web: {
        enabled: false,
        bind: '127.0.0.1:0',
        bearer_env: 'LINNSY_WEB_BEARER'
      },
      ...channelOverrides
    },
    auth: {
      global_all: false,
      pairing: {
        code_ttl_ms: 600000,
        max_attempts: 5
      }
    },
    cron: {
      tick_interval_ms: 60000,
      default_miss_grace_ms: 7200000
    },
    memory: {
      on_pre_compress_provider: 'builtin'
    },
    mcp: {
      server: {
        enabled: true,
        transport: 'stdio'
      },
      clients: []
    }
  };
}

function createCapturingLogger(capture: (message: string) => void): LoggerPort {
  return {
    info: () => undefined,
    warn: (message) => {
      capture(message);
    },
    error: () => undefined
  };
}
