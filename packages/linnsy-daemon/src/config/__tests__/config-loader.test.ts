import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { loadLinnsyConfig } from '../loader.js';
import { createTempLinnsyHome } from '../../../__tests__/harness/temp-home.js';

describe('loadLinnsyConfig', () => {
  test('loads a valid config from LINNSY_HOME', async () => {
    const home = await createTempLinnsyHome();

    try {
      await writeFile(
        join(home, 'config.yaml'),
        [
          'profile: test',
          `home: ${home}`,
          'llm:',
          '  default_provider: openai',
          '  defaults:',
          '    secretary: openai.gpt5',
          '    cron_summary: anthropic.sonnet',
          '    memory_consolidate: openai.gpt5-mini',
          '  providers:',
          '    openai:',
          '      api_protocol: openai_responses',
          '      api_key_env: LINNSY_OPENAI_KEY',
          '      models:',
          '        gpt5:',
          '          model_name: gpt-5',
          '          fallback_chain: [openai.gpt5-mini]',
          '        gpt5-mini:',
          '          model_name: gpt-5-mini',
          'channels:',
          '  cli: { enabled: true }',
          '  web: { enabled: true, bind: "127.0.0.1:7700", bearer_env: LINNSY_WEB_BEARER }',
          'auth:',
          '  global_all: false',
          '  pairing: { code_ttl_ms: 600000, max_attempts: 5 }',
          'cron: { tick_interval_ms: 60000, default_miss_grace_ms: 7200000 }',
          'memory: { on_pre_compress_provider: builtin }',
          'mcp: { server: { enabled: true, transport: stdio }, clients: [] }'
        ].join('\n')
      );

      const config = await loadLinnsyConfig({ env: { LINNSY_HOME: home } });

      expect(config.profile).toBe('test');
      expect(config.llm.defaults.secretary).toBe('openai.gpt5');
      expect(config.channels.cli.enabled).toBe(true);
      expect(config.workspace?.root).toBe(join(home, 'workspaces'));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('auto-migrates a legacy home before reading config', async () => {
    const root = await createTempLinnsyHome();
    const legacyHome = join(root, '.linnsy');
    const standardHome = join(root, 'Library', 'Application Support', 'Linnsy');

    try {
      await mkdir(legacyHome, { recursive: true });
      await mkdir(standardHome, { recursive: true });
      await writeFile(
        join(legacyHome, 'config.yaml'),
        [
          'profile: test',
          `home: ${legacyHome}`,
          'llm:',
          '  default_provider: openai',
          '  defaults: { secretary: openai.gpt5, cron_summary: openai.gpt5, memory_consolidate: openai.gpt5 }',
          '  providers:',
          '    openai:',
          '      api_protocol: openai_responses',
          '      api_key_env: LINNSY_OPENAI_KEY',
          '      models: { gpt5: { model_name: gpt-5 } }',
          'channels:',
          '  cli: { enabled: true }',
          '  web: { enabled: false, bind: "127.0.0.1:0", bearer_env: LINNSY_WEB_BEARER }',
          'auth: { global_all: false, pairing: { code_ttl_ms: 600000, max_attempts: 5 } }',
          'cron: { tick_interval_ms: 60000, default_miss_grace_ms: 7200000 }',
          'memory: { on_pre_compress_provider: builtin }',
          'mcp: { server: { enabled: true, transport: stdio }, clients: [] }'
        ].join('\n')
      );

      const config = await loadLinnsyConfig({ env: { HOME: root } });

      expect(config.home).toBe(standardHome);
      await expect(readFile(join(standardHome, 'config.yaml'), 'utf8')).resolves.toContain('profile: test');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('validates telegram channel config instead of accepting arbitrary passthrough', async () => {
    const home = await createTempLinnsyHome();

    try {
      await writeFile(
        join(home, 'config.yaml'),
        [
          'profile: test',
          `home: ${home}`,
          'llm:',
          '  default_provider: openai',
          '  defaults: { secretary: openai.gpt5, cron_summary: openai.gpt5, memory_consolidate: openai.gpt5 }',
          '  providers:',
          '    openai:',
          '      api_protocol: openai_responses',
          '      api_key_env: LINNSY_OPENAI_KEY',
          '      models: { gpt5: { model_name: gpt-5 } }',
          'channels:',
          '  cli: { enabled: true }',
          '  web: { enabled: false, bind: "127.0.0.1:7700", bearer_env: LINNSY_WEB_BEARER }',
          '  telegram:',
          '    enabled: true',
          '    token_env: LINNSY_TELEGRAM_TOKEN',
          '    allowlist: ["12345"]',
          'auth: { global_all: false, pairing: { code_ttl_ms: 600000, max_attempts: 5 } }',
          'cron: { tick_interval_ms: 60000, default_miss_grace_ms: 7200000 }',
          'memory: { on_pre_compress_provider: builtin }',
          'mcp: { server: { enabled: true, transport: stdio }, clients: [] }'
        ].join('\n')
      );

      const config = await loadLinnsyConfig({ env: { LINNSY_HOME: home } });

      expect(config.channels.telegram).toEqual({
        enabled: true,
        token_env: 'LINNSY_TELEGRAM_TOKEN',
        allowlist: ['12345']
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('loads a valid wechat channel config without requiring manual WeChat bot API credentials', async () => {
    const home = await createTempLinnsyHome();

    try {
      await writeFile(
        join(home, 'config.yaml'),
        [
          'profile: test',
          `home: ${home}`,
          'llm:',
          '  default_provider: openai',
          '  defaults: { secretary: openai.gpt5, cron_summary: openai.gpt5, memory_consolidate: openai.gpt5 }',
          '  providers:',
          '    openai:',
          '      api_protocol: openai_responses',
          '      api_key_env: LINNSY_OPENAI_KEY',
          '      models: { gpt5: { model_name: gpt-5 } }',
          'channels:',
          '  cli: { enabled: true }',
          '  web: { enabled: false, bind: "127.0.0.1:7700", bearer_env: LINNSY_WEB_BEARER }',
          '  wechat:',
          '    enabled: true',
          '    gateway_bind: "127.0.0.1:7788"',
          '    gateway_base_url: "http://127.0.0.1:7788"',
          '    bearer_env: LINNSY_WECHAT_GATEWAY_BEARER',
          '    poll_interval_ms: 1500',
          'auth: { global_all: false, pairing: { code_ttl_ms: 600000, max_attempts: 5 } }',
          'cron: { tick_interval_ms: 60000, default_miss_grace_ms: 7200000 }',
          'memory: { on_pre_compress_provider: builtin }',
          'mcp: { server: { enabled: true, transport: stdio }, clients: [] }'
        ].join('\n')
      );

      const config = await loadLinnsyConfig({ env: { LINNSY_HOME: home } });

      expect(config.channels.wechat).toEqual({
        enabled: true,
        gateway_bind: '127.0.0.1:7788',
        gateway_base_url: 'http://127.0.0.1:7788',
        bearer_env: 'LINNSY_WECHAT_GATEWAY_BEARER',
        poll_interval_ms: 1500
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('rejects invalid wechat channel config instead of accepting arbitrary passthrough', async () => {
    const home = await createTempLinnsyHome();

    try {
      await writeFile(
        join(home, 'config.yaml'),
        [
          'profile: test',
          `home: ${home}`,
          'llm:',
          '  default_provider: openai',
          '  defaults: { secretary: openai.gpt5, cron_summary: openai.gpt5, memory_consolidate: openai.gpt5 }',
          '  providers:',
          '    openai:',
          '      api_protocol: openai_responses',
          '      api_key_env: LINNSY_OPENAI_KEY',
          '      models: { gpt5: { model_name: gpt-5 } }',
          'channels:',
          '  cli: { enabled: true }',
          '  web: { enabled: false, bind: "127.0.0.1:7700", bearer_env: LINNSY_WEB_BEARER }',
          '  wechat:',
          '    enabled: true',
          '    gateway_bind: "127.0.0.1:7788"',
          '    gateway_base_url: "not-a-url"',
          '    bearer_env: LINNSY_WECHAT_GATEWAY_BEARER',
          '    poll_interval_ms: -1',
          'auth: { global_all: false, pairing: { code_ttl_ms: 600000, max_attempts: 5 } }',
          'cron: { tick_interval_ms: 60000, default_miss_grace_ms: 7200000 }',
          'memory: { on_pre_compress_provider: builtin }',
          'mcp: { server: { enabled: true, transport: stdio }, clients: [] }'
        ].join('\n')
      );

      await expect(loadLinnsyConfig({ env: { LINNSY_HOME: home } })).rejects.toThrow(
        'channels.wechat.gateway_base_url'
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('loads optional manual WeChat bot API overrides for wechat gateway', async () => {
    const home = await createTempLinnsyHome();

    try {
      await writeFile(
        join(home, 'config.yaml'),
        [
          'profile: test',
          `home: ${home}`,
          'llm:',
          '  default_provider: openai',
          '  defaults: { secretary: openai.gpt5, cron_summary: openai.gpt5, memory_consolidate: openai.gpt5 }',
          '  providers:',
          '    openai:',
          '      api_protocol: openai_responses',
          '      api_key_env: LINNSY_OPENAI_KEY',
          '      models: { gpt5: { model_name: gpt-5 } }',
          'channels:',
          '  cli: { enabled: true }',
          '  web: { enabled: false, bind: "127.0.0.1:7700", bearer_env: LINNSY_WEB_BEARER }',
          '  wechat:',
          '    enabled: true',
          '    gateway_bind: "127.0.0.1:7788"',
          '    gateway_base_url: "http://127.0.0.1:7788"',
          '    bearer_env: LINNSY_WECHAT_GATEWAY_BEARER',
          '    wechat_bot_api_base_url: "http://127.0.0.1:8787"',
          '    wechat_bot_api_token_env: LINNSY_WECHAT_BOT_API_TOKEN',
          '    poll_interval_ms: 1500',
          'auth: { global_all: false, pairing: { code_ttl_ms: 600000, max_attempts: 5 } }',
          'cron: { tick_interval_ms: 60000, default_miss_grace_ms: 7200000 }',
          'memory: { on_pre_compress_provider: builtin }',
          'mcp: { server: { enabled: true, transport: stdio }, clients: [] }'
        ].join('\n')
      );

      const config = await loadLinnsyConfig({ env: { LINNSY_HOME: home } });

      expect(config.channels.wechat).toEqual({
        enabled: true,
        gateway_bind: '127.0.0.1:7788',
        gateway_base_url: 'http://127.0.0.1:7788',
        bearer_env: 'LINNSY_WECHAT_GATEWAY_BEARER',
        wechat_bot_api_base_url: 'http://127.0.0.1:8787',
        wechat_bot_api_token_env: 'LINNSY_WECHAT_BOT_API_TOKEN',
        poll_interval_ms: 1500
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('rejects unknown channel keys such as misspelled wechat', async () => {
    const home = await createTempLinnsyHome();

    try {
      await writeFile(
        join(home, 'config.yaml'),
        [
          'profile: test',
          `home: ${home}`,
          'llm:',
          '  default_provider: openai',
          '  defaults: { secretary: openai.gpt5, cron_summary: openai.gpt5, memory_consolidate: openai.gpt5 }',
          '  providers:',
          '    openai:',
          '      api_protocol: openai_responses',
          '      api_key_env: LINNSY_OPENAI_KEY',
          '      models: { gpt5: { model_name: gpt-5 } }',
          'channels:',
          '  cli: { enabled: true }',
          '  web: { enabled: false, bind: "127.0.0.1:7700", bearer_env: LINNSY_WEB_BEARER }',
          '  wecaht:',
          '    enabled: true',
          'auth: { global_all: false, pairing: { code_ttl_ms: 600000, max_attempts: 5 } }',
          'cron: { tick_interval_ms: 60000, default_miss_grace_ms: 7200000 }',
          'memory: { on_pre_compress_provider: builtin }',
          'mcp: { server: { enabled: true, transport: stdio }, clients: [] }'
        ].join('\n')
      );

      await expect(loadLinnsyConfig({ env: { LINNSY_HOME: home } })).rejects.toThrow('channels');
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('loads a custom workspace root when configured', async () => {
    const home = await createTempLinnsyHome();
    const workspaceRoot = join(home, 'custom-workspaces');

    try {
      await writeFile(
        join(home, 'config.yaml'),
        [
          'profile: test',
          `home: ${home}`,
          `workspace: { root: ${workspaceRoot} }`,
          'runtime: { internal_subagent: { max_concurrency: 2 } }',
          'llm:',
          '  default_provider: openai',
          '  defaults: { secretary: openai.gpt5, cron_summary: openai.gpt5, memory_consolidate: openai.gpt5 }',
          '  providers:',
          '    openai:',
          '      api_protocol: openai_responses',
          '      api_key_env: LINNSY_OPENAI_KEY',
          '      models: { gpt5: { model_name: gpt-5 } }',
          'channels: { cli: { enabled: true }, web: { enabled: false, bind: "127.0.0.1:7700", bearer_env: LINNSY_WEB_BEARER } }',
          'auth: { global_all: false, pairing: { code_ttl_ms: 600000, max_attempts: 5 } }',
          'cron: { tick_interval_ms: 60000, default_miss_grace_ms: 7200000 }',
          'memory: { on_pre_compress_provider: builtin }',
          'mcp: { server: { enabled: true, transport: stdio }, clients: [] }'
        ].join('\n')
      );

      const config = await loadLinnsyConfig({ env: { LINNSY_HOME: home } });

      expect(config.workspace?.root).toBe(workspaceRoot);
      expect(config.runtime?.internal_subagent?.max_concurrency).toBe(2);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('reports missing fields with the field path', async () => {
    const home = await createTempLinnsyHome();

    try {
      await writeFile(join(home, 'config.yaml'), 'profile: test\n');

      await expect(loadLinnsyConfig({ env: { LINNSY_HOME: home } })).rejects.toThrow('llm');
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('creates LINNSY_HOME with owner-only permissions when missing', async () => {
    const parent = await createTempLinnsyHome();
    const home = join(parent, 'missing-home');

    try {
      await mkdir(home, { recursive: true, mode: 0o700 });
      await writeFile(join(home, 'config.yaml'), minimalConfig(home));
      const config = await loadLinnsyConfig({ env: { LINNSY_HOME: home } });

      expect(config.home).toBe(home);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});

function minimalConfig(home: string): string {
  return [
    'profile: test',
    `home: ${home}`,
    'llm:',
    '  default_provider: openai',
    '  defaults: { secretary: openai.gpt5, cron_summary: openai.gpt5, memory_consolidate: openai.gpt5 }',
    '  providers:',
    '    openai:',
    '      api_protocol: openai_responses',
    '      api_key_env: LINNSY_OPENAI_KEY',
    '      models: { gpt5: { model_name: gpt-5 } }',
    'channels: { cli: { enabled: true }, web: { enabled: false, bind: "127.0.0.1:7700", bearer_env: LINNSY_WEB_BEARER } }',
    'auth: { global_all: false, pairing: { code_ttl_ms: 600000, max_attempts: 5 } }',
    'cron: { tick_interval_ms: 60000, default_miss_grace_ms: 7200000 }',
    'memory: { on_pre_compress_provider: builtin }',
    'mcp: { server: { enabled: true, transport: stdio }, clients: [] }'
  ].join('\n');
}
