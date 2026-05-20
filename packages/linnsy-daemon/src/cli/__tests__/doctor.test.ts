import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../__tests__/harness/temp-home.js';
import { runDoctor } from '../doctor.js';

describe('runDoctor', () => {
  test('passes with valid config, sqlite, and required API env', async () => {
    const home = await createTempLinnsyHome();

    try {
      await writeFile(join(home, 'config.yaml'), minimalConfig(home));

      const result = await runDoctor({
        env: {
          LINNSY_HOME: home,
          LINNSY_OPENAI_KEY: 'test-key',
          LINNSY_WEB_BEARER: 'bearer'
        }
      });

      expect(result.ok).toBe(true);
      expect(result.checks.map((check) => check.name)).toEqual([
        'config',
        'home_permissions',
        'workspace_permissions',
        'sqlite',
        'model_registry',
        'model_profile',
        'api_key_env'
      ]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('checks every configured default model api key env', async () => {
    const home = await createTempLinnsyHome();

    try {
      await writeFile(join(home, 'config.yaml'), [
        'profile: test',
        `home: ${home}`,
        'llm:',
        '  default_provider: openai',
        '  defaults: { secretary: openai.gpt5, cron_summary: anthropic.sonnet, memory_consolidate: openai.gpt5 }',
        '  providers:',
        '    openai:',
        '      api_protocol: openai_responses',
        '      api_key_env: LINNSY_OPENAI_KEY',
        '      models: { gpt5: { model_name: gpt-5 } }',
        '    anthropic:',
        '      api_protocol: anthropic_messages',
        '      api_key_env: LINNSY_ANTHROPIC_KEY',
        '      models: { sonnet: { model_name: claude-sonnet } }',
        'channels: { cli: { enabled: true }, web: { enabled: true, bind: "127.0.0.1:7700", bearer_env: LINNSY_WEB_BEARER } }',
        'auth: { global_all: false, pairing: { code_ttl_ms: 600000, max_attempts: 5 } }',
        'cron: { tick_interval_ms: 60000, default_miss_grace_ms: 7200000 }',
        'memory: { on_pre_compress_provider: builtin }',
        'mcp: { server: { enabled: true, transport: stdio }, clients: [] }'
      ].join('\n'));

      const result = await runDoctor({
        env: {
          LINNSY_HOME: home,
          LINNSY_OPENAI_KEY: 'test-key',
          LINNSY_WEB_BEARER: 'bearer'
        }
      });

      expect(result.ok).toBe(false);
      expect(result.checks).toContainEqual({
        name: 'api_key_env',
        ok: false,
        message: 'Missing env LINNSY_ANTHROPIC_KEY for default cron_summary model anthropic.sonnet'
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('flags model_profile when capabilities and reasoning settings disagree', async () => {
    const home = await createTempLinnsyHome();

    try {
      await writeFile(join(home, 'config.yaml'), [
        'profile: test',
        `home: ${home}`,
        'llm:',
        '  default_provider: openai',
        '  defaults: { secretary: openai.gpt5, cron_summary: openai.gpt5, memory_consolidate: openai.gpt5 }',
        '  providers:',
        '    openai:',
        '      api_protocol: openai_responses',
        '      api_key_env: LINNSY_OPENAI_KEY',
        '      models:',
        '        gpt5:',
        '          model_name: gpt-5',
        '          capabilities: { context_window_tokens: 8192, max_output_tokens: 16384, supports_reasoning: false }',
        '          reasoning: { enabled: true }',
        'channels: { cli: { enabled: true }, web: { enabled: true, bind: "127.0.0.1:7700", bearer_env: LINNSY_WEB_BEARER } }',
        'auth: { global_all: false, pairing: { code_ttl_ms: 600000, max_attempts: 5 } }',
        'cron: { tick_interval_ms: 60000, default_miss_grace_ms: 7200000 }',
        'memory: { on_pre_compress_provider: builtin }',
        'mcp: { server: { enabled: true, transport: stdio }, clients: [] }'
      ].join('\n'));

      const result = await runDoctor({
        env: {
          LINNSY_HOME: home,
          LINNSY_OPENAI_KEY: 'test-key',
          LINNSY_WEB_BEARER: 'bearer'
        }
      });

      expect(result.ok).toBe(false);
      const messages = result.checks.filter((check) => check.name === 'model_profile').map((check) => check.message);
      expect(messages).toContain(
        'secretary (openai.gpt5): capabilities.max_output_tokens (16384) exceeds context_window_tokens (8192)'
      );
      expect(messages).toContain(
        'secretary (openai.gpt5): reasoning.enabled=true but capabilities.supports_reasoning=false'
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('allows OpenAI-compatible provider_options on DeepSeek models', async () => {
    const home = await createTempLinnsyHome();

    try {
      await writeFile(join(home, 'config.yaml'), [
        'profile: test',
        `home: ${home}`,
        'llm:',
        '  default_provider: deepseek',
        '  defaults: { secretary: deepseek.v4, cron_summary: deepseek.v4, memory_consolidate: deepseek.v4 }',
        '  providers:',
        '    deepseek:',
        '      api_protocol: openai_chat',
        '      api_key_env: LINNSY_DEEPSEEK_KEY',
        '      models:',
        '        v4:',
        '          model_name: deepseek-v4-pro',
        '          provider_options:',
        '            openai:',
        '              request_extra_body:',
        '                thinking: { type: enabled }',
        '                reasoning_effort: high',
        'channels: { cli: { enabled: true }, web: { enabled: true, bind: "127.0.0.1:7700", bearer_env: LINNSY_WEB_BEARER } }',
        'auth: { global_all: false, pairing: { code_ttl_ms: 600000, max_attempts: 5 } }',
        'cron: { tick_interval_ms: 60000, default_miss_grace_ms: 7200000 }',
        'memory: { on_pre_compress_provider: builtin }',
        'mcp: { server: { enabled: true, transport: stdio }, clients: [] }'
      ].join('\n'));

      const result = await runDoctor({
        env: {
          LINNSY_HOME: home,
          LINNSY_DEEPSEEK_KEY: 'test-key',
          LINNSY_WEB_BEARER: 'bearer'
        }
      });

      expect(result.ok).toBe(true);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('flags provider_options that target the wrong protocol', async () => {
    const home = await createTempLinnsyHome();

    try {
      await writeFile(join(home, 'config.yaml'), [
        'profile: test',
        `home: ${home}`,
        'llm:',
        '  default_provider: openai',
        '  defaults: { secretary: openai.gpt5, cron_summary: openai.gpt5, memory_consolidate: openai.gpt5 }',
        '  providers:',
        '    openai:',
        '      api_protocol: openai_responses',
        '      api_key_env: LINNSY_OPENAI_KEY',
        '      models:',
        '        gpt5:',
        '          model_name: gpt-5',
        '          provider_options: { anthropic: { thinking_budget_tokens: 4096 } }',
        'channels: { cli: { enabled: true }, web: { enabled: true, bind: "127.0.0.1:7700", bearer_env: LINNSY_WEB_BEARER } }',
        'auth: { global_all: false, pairing: { code_ttl_ms: 600000, max_attempts: 5 } }',
        'cron: { tick_interval_ms: 60000, default_miss_grace_ms: 7200000 }',
        'memory: { on_pre_compress_provider: builtin }',
        'mcp: { server: { enabled: true, transport: stdio }, clients: [] }'
      ].join('\n'));

      const result = await runDoctor({
        env: {
          LINNSY_HOME: home,
          LINNSY_OPENAI_KEY: 'test-key',
          LINNSY_WEB_BEARER: 'bearer'
        }
      });

      expect(result.ok).toBe(false);
      const messages = result.checks.filter((check) => check.name === 'model_profile').map((check) => check.message);
      expect(messages).toContain(
        'secretary (openai.gpt5): provider_options.anthropic is only valid for Anthropic-compatible protocols (current protocol=openai_responses)'
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('reports missing config file with an actionable message', async () => {
    const home = await createTempLinnsyHome();

    try {
      const result = await runDoctor({
        env: {
          LINNSY_HOME: home
        }
      });

      expect(result.ok).toBe(false);
      expect(result.checks[0]).toMatchObject({
        name: 'config',
        ok: false,
        message: `Config file not found at ${join(home, 'config.yaml')}. Create it or set LINNSY_HOME to a directory that contains config.yaml.`
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('flags workspace root when it is not writable as a directory', async () => {
    const home = await createTempLinnsyHome();

    try {
      await writeFile(join(home, 'config.yaml'), minimalConfig(home));
      await writeFile(join(home, 'workspaces'), 'not a directory');

      const result = await runDoctor({
        env: {
          LINNSY_HOME: home,
          LINNSY_OPENAI_KEY: 'test-key',
          LINNSY_WEB_BEARER: 'bearer'
        }
      });

      expect(result.ok).toBe(false);
      expect(result.checks).toContainEqual({
        name: 'workspace_permissions',
        ok: false,
        message: `Workspace root is not writable: ${join(home, 'workspaces')} is not a directory`
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('fails with a config check when config is invalid', async () => {
    const home = await createTempLinnsyHome();

    try {
      await writeFile(join(home, 'config.yaml'), 'profile: test\n');

      const result = await runDoctor({
        env: {
          LINNSY_HOME: home
        }
      });

      expect(result.ok).toBe(false);
      expect(result.checks[0]?.name).toBe('config');
      expect(result.checks[0]?.ok).toBe(false);
    } finally {
      await rm(home, { recursive: true, force: true });
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
    'channels: { cli: { enabled: true }, web: { enabled: true, bind: "127.0.0.1:7700", bearer_env: LINNSY_WEB_BEARER } }',
    'auth: { global_all: false, pairing: { code_ttl_ms: 600000, max_attempts: 5 } }',
    'cron: { tick_interval_ms: 60000, default_miss_grace_ms: 7200000 }',
    'memory: { on_pre_compress_provider: builtin }',
    'mcp: { server: { enabled: true, transport: stdio }, clients: [] }'
  ].join('\n');
}
