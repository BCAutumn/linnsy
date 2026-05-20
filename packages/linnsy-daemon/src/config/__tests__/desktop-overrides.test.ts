import { describe, expect, test } from 'vitest';

import { applyDesktopRuntimeOverrides } from '../desktop-overrides.js';
import type { LinnsyConfig } from '../schema.js';

describe('desktop runtime overrides', () => {
  test('leaves normal CLI config unchanged', () => {
    const config = configFixture();

    expect(applyDesktopRuntimeOverrides(config, {})).toBe(config);
  });

  test('enables the local web API for Electron without mutating config.yaml values', () => {
    const config = configFixture();
    const result = applyDesktopRuntimeOverrides(config, {
      LINNSY_DESKTOP_MODE: '1',
      LINNSY_DAEMON_URL: 'http://127.0.0.1:7700'
    });

    expect(result.channels.web).toEqual({
      enabled: true,
      bind: '127.0.0.1:7700',
      bearer_env: 'LINNSY_WEB_BEARER'
    });
    expect(config.channels.web).toEqual({
      enabled: false,
      bind: '127.0.0.1:0',
      bearer_env: 'LINNSY_WEB_BEARER'
    });
  });

  test('keeps configured WeChat disabled in desktop mode until the user connects it', () => {
    const config = configFixture({
      wechat: {
        enabled: true,
        gateway_bind: '127.0.0.1:7788',
        gateway_base_url: 'http://127.0.0.1:7788',
        bearer_env: 'LINNSY_WECHAT_GATEWAY_BEARER',
        poll_interval_ms: 1500
      }
    });

    expect(applyDesktopRuntimeOverrides(config, { LINNSY_DESKTOP_MODE: '1' }).channels.wechat?.enabled).toBe(false);
    expect(applyDesktopRuntimeOverrides(config, {
      LINNSY_DESKTOP_MODE: '1',
      LINNSY_DESKTOP_WECHAT_CONNECT: '1'
    }).channels.wechat?.enabled).toBe(true);
  });
});

function configFixture(overrides: Partial<LinnsyConfig['channels']> = {}): LinnsyConfig {
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
      ...overrides
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
