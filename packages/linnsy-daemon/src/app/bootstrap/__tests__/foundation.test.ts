import type { LinnsyConfig } from '../../../config/schema.js';
import { createLinnsyRuntimeFoundation } from '../foundation.js';
import { createTempLinnsyHome } from '../../../../__tests__/harness/temp-home.js';
import { createFakeClock } from '../../../../__tests__/harness/fake-clock.js';
import { rm } from 'node:fs/promises';
import type { LinnsyProviderRouter } from '../../../domains/llm/features/provider-routing/provider-router.js';

describe('createLinnsyRuntimeFoundation', () => {
  test('assembles db-backed linnkit runtime primitives and can persist a graph checkpoint', async () => {
    const home = await createTempLinnsyHome();
    const runtime = createLinnsyRuntimeFoundation(minimalConfig(home), {
      env: {
        LINNSY_OPENAI_KEY: 'test-key'
      }
    });

    try {
      runtime.db
        .prepare(
          'INSERT INTO conversations (conversation_id, session_key, platform, chat_type, chat_id, created_at, updated_at, last_activity_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run('conv_1', 'linnsy:test:conv_1', 'cli', 'private', 'conv_1', 1, 1, 1);

      await runtime.graphExecutor.prime('conv_1', { conversationId: 'conv_1' }, 'user');

      await expect(runtime.graphExecutor.peekCheckpoint('conv_1')).resolves.toMatchObject({
        nodeId: 'user',
        local: {
          conversationId: 'conv_1'
        }
      });
      await expect(runtime.runRegistry.list({ limit: 10 })).resolves.toEqual({ runs: [] });
      await expect(runtime.cronStore.list()).resolves.toEqual([]);
      await expect(runtime.pairings.hasAuthorizedPairing({
        platform: 'telegram',
        chatId: 'chat_1'
      })).resolves.toBe(false);
      expect(runtime.modelRegistry.getDefaultModel('secretary')).toMatchObject({
        id: 'openai.gpt5',
        modelName: 'gpt-5'
      });
      expect(runtime.aiEngine).toBeDefined();
    } finally {
      runtime.dispose();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('injects clock/logger ports and disposes provider router resources', async () => {
    const home = await createTempLinnsyHome();
    const clock = createFakeClock(1234);
    const logMessages: string[] = [];
    let disposed = false;
    const providerRouter: LinnsyProviderRouter = {
      resolve() {
        throw new Error('not used');
      },
      dispose() {
        disposed = true;
      }
    };
    const runtime = createLinnsyRuntimeFoundation(minimalConfig(home), {
      clock,
      logger: {
        info(message) {
          logMessages.push(message);
        },
        warn(message) {
          logMessages.push(message);
        },
        error(message) {
          logMessages.push(message);
        }
      },
      providerRouter
    });

    try {
      runtime.db
        .prepare(
          'INSERT INTO conversations (conversation_id, session_key, platform, chat_type, chat_id, created_at, updated_at, last_activity_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run('conv_1', 'linnsy:test:conv_1', 'cli', 'private', 'conv_1', 1, 1, 1);

      await runtime.checkpointer.save('conv_1', { nodeId: 'user', schemaVersion: 1 });

      expect(runtime.clock.now()).toBe(1234);
      expect(runtime.logger).toBeDefined();
      expect(runtime.db.prepare('SELECT updated_at FROM checkpoints WHERE conversation_id = ?').get('conv_1')).toEqual({
        updated_at: 1234
      });
    } finally {
      runtime.dispose();
      expect(disposed).toBe(true);
      expect(logMessages).toContain('Linnsy runtime foundation disposed');
      await rm(home, { recursive: true, force: true });
    }
  });
});

function minimalConfig(home: string): LinnsyConfig {
  return {
    profile: 'test',
    home,
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
            gpt5: {
              model_name: 'gpt-5'
            }
          }
        }
      }
    },
    channels: {
      cli: { enabled: true },
      web: { enabled: false, bind: '127.0.0.1:7700', bearer_env: 'LINNSY_WEB_BEARER' }
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
