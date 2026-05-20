/**
 * Live end-to-end smoke against any OpenAI-compatible endpoint.
 *
 * Opt-in: 默认 skip，不影响 `pnpm test` 与 CI。
 *
 * 默认走 OpenAI 官方：
 *   OPENAI_API_KEY=sk-... pnpm vitest run __tests__/e2e/live-openai-chat.spec.ts
 *
 * 走 DeepSeek 等 OpenAI 兼容端点（base_url + 自定义 key env）：
 *   LINNSY_LIVE_BASE_URL=https://api.deepseek.com \
 *   LINNSY_LIVE_API_KEY_ENV=DEEPSEEK_API_KEY \
 *   LINNSY_LIVE_MODEL=deepseek-chat \
 *   DEEPSEEK_API_KEY=sk-... \
 *   pnpm vitest run __tests__/e2e/live-openai-chat.spec.ts
 *
 * 额外开 reasoning case（透传 provider_options.openai.request_extra_body）：
 *   LINNSY_LIVE_REASONING=1 \
 *   LINNSY_LIVE_REASONING_MODEL=deepseek-v4-pro \
 *   <上述任一 endpoint env...> \
 *   pnpm vitest run __tests__/e2e/live-openai-chat.spec.ts
 *
 * 触达链路：
 *   CLIChannelAdapter -> Daemon.handleTurn -> AuthGuard(stub) -> SessionRouter
 *   -> AgentRegistry -> SystemPromptAssembler -> RunSpawner
 *   -> LinnkitGraphRunExecutor (真) -> AiEngineBridge -> OpenAI SDK
 *   -> NotificationLayer.replyForRun -> Channel.send + outbound 落 messages 表
 */

import { rm } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, test } from 'vitest';

import type { LinnsyConfig } from '../../src/config/schema.js';
import {
  createCliChannelAdapter,
  createLinnkitGraphRunExecutor,
  createLinnsyDaemon,
  createLinnsyRuntimeFoundation,
  createSystemPromptAssembler
} from '../../src/index.js';
import type { LinnsyRuntimeFoundation } from '../../src/index.js';
import { createTempLinnsyHome } from '../harness/temp-home.js';

const LIVE_API_KEY_ENV = process.env.LINNSY_LIVE_API_KEY_ENV ?? 'OPENAI_API_KEY';
const LIVE_KEY = process.env[LIVE_API_KEY_ENV];
const SKIP = LIVE_KEY === undefined || LIVE_KEY.length === 0;

const LIVE_MODEL_NAME = process.env.LINNSY_LIVE_MODEL ?? 'gpt-4o-mini';
const LIVE_BASE_URL = process.env.LINNSY_LIVE_BASE_URL;
const TURN_TIMEOUT_MS = 60_000;
const RTT_BUDGET_MS = 30_000;

const REASONING_ENABLED = process.env.LINNSY_LIVE_REASONING === '1';
const REASONING_MODEL_NAME = process.env.LINNSY_LIVE_REASONING_MODEL ?? 'deepseek-v4-pro';
const REASONING_TURN_TIMEOUT_MS = 120_000;
const REASONING_RTT_BUDGET_MS = 90_000;
const REASONING_SKIP = SKIP || !REASONING_ENABLED;

function liveConfig(home: string): LinnsyConfig {
  const openaiProvider: LinnsyConfig['llm']['providers'][string] = {
    api_protocol: 'openai_chat',
    api_key_env: LIVE_API_KEY_ENV,
    models: {
      live: {
        model_name: LIVE_MODEL_NAME,
        capabilities: {
          context_window_tokens: 128_000,
          max_output_tokens: 4_096,
          supports_tools: true,
          supports_streaming: true
        },
        request_defaults: {
          temperature: 0,
          max_tokens: 256
        }
      }
    },
    ...(LIVE_BASE_URL === undefined ? {} : { base_url: LIVE_BASE_URL })
  };
  return {
    profile: 'live-smoke',
    home,
    llm: {
      default_provider: 'openai',
      defaults: {
        secretary: 'openai.live',
        cron_summary: 'openai.live',
        memory_consolidate: 'openai.live'
      },
      providers: { openai: openaiProvider }
    },
    channels: {
      cli: { enabled: true },
      web: {
        enabled: false,
        bind: '127.0.0.1:7700',
        bearer_env: 'LINNSY_WEB_BEARER'
      }
    },
    auth: {
      global_all: true,
      pairing: { code_ttl_ms: 600_000, max_attempts: 5 }
    },
    cron: { tick_interval_ms: 60_000, default_miss_grace_ms: 7_200_000 },
    memory: { on_pre_compress_provider: 'builtin' },
    mcp: { server: { enabled: false, transport: 'stdio' }, clients: [] }
  };
}

function liveReasoningConfig(home: string): LinnsyConfig {
  const base = liveConfig(home);
  const provider = base.llm.providers.openai;
  if (provider === undefined) {
    throw new Error('liveConfig must define openai provider');
  }
  return {
    ...base,
    llm: {
      ...base.llm,
      providers: {
        openai: {
          ...provider,
          models: {
            live: {
              model_name: REASONING_MODEL_NAME,
              capabilities: {
                context_window_tokens: 128_000,
                max_output_tokens: 8_192,
                supports_tools: true,
                supports_streaming: true,
                supports_reasoning: true
              },
              request_defaults: {
                max_tokens: 1_024
              },
              provider_options: {
                openai: {
                  request_extra_body: {
                    thinking: { type: 'enabled' },
                    reasoning_effort: 'high'
                  }
                }
              }
            }
          }
        }
      }
    }
  };
}

interface LiveFixture {
  foundation: LinnsyRuntimeFoundation;
  stdin: PassThrough;
  stdout: PassThrough;
  stdoutChunks: string[];
  cleanup(): Promise<void>;
}

async function createLiveFixture(
  configFactory: (home: string) => LinnsyConfig = liveConfig
): Promise<LiveFixture> {
  const home = await createTempLinnsyHome();
  const foundation = createLinnsyRuntimeFoundation(configFactory(home), {
    env: process.env
  });
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stdoutChunks: string[] = [];
  stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk.toString('utf8')));
  return {
    foundation,
    stdin,
    stdout,
    stdoutChunks,
    async cleanup() {
      foundation.dispose();
      await rm(home, { recursive: true, force: true });
    }
  };
}

const fixtures: LiveFixture[] = [];
afterEach(async () => {
  while (fixtures.length > 0) {
    const fx = fixtures.pop();
    if (fx !== undefined) {
      await fx.cleanup();
    }
  }
});

describe.skipIf(SKIP)(`linnsy live LLM chat (opt-in via ${LIVE_API_KEY_ENV})`, () => {
  test(
    'CLI inbound -> real LLM -> CLI outbound + DB persistence',
    async () => {
      const fixture = await createLiveFixture();
      fixtures.push(fixture);

      const systemPromptAssembler = createSystemPromptAssembler({
        clock: fixture.foundation.clock
      });
      const executor = createLinnkitGraphRunExecutor({
        foundation: fixture.foundation,
        systemPromptAssembler
      });
      const channel = createCliChannelAdapter({
        stdin: fixture.stdin,
        stdout: fixture.stdout,
        outboundPrefix: '> '
      });
      const daemon = createLinnsyDaemon({
        foundation: fixture.foundation,
        channels: [channel],
        executor,
        systemPromptAssembler,
        awaitTurnInHandler: true
      });

      await daemon.start();

      const startedAt = Date.now();
      // 用一个低歧义、低 token 的探针 prompt；temperature=0 + max_tokens=256
      // 让回包稳定且短；不强求模型说出特定词，只断言 outbound 非空可读。
      fixture.stdin.write('Reply with the single word: pong\n');

      // 等 DB 真有 outbound 落盘（避开"stdout 已出但 messages.insert 还在 await"的 race）
      const conversationId = await waitForConversationId(fixture, TURN_TIMEOUT_MS);
      await waitForOutboundCount(fixture, conversationId, 1, TURN_TIMEOUT_MS);
      const elapsedMs = Date.now() - startedAt;

      await daemon.stop();

      // 1) 端到端 RTT 真实上限（含网络 + LLM）
      expect(elapsedMs).toBeLessThan(RTT_BUDGET_MS);

      // 2) channel 实际有过 outbound 输出
      expect(fixture.stdoutChunks.join('')).toContain('> ');

      const messages = await fixture.foundation.messages.listByConversation(conversationId, {
        limit: 10
      });
      expect(messages.messages.map((m) => `${m.role}:${m.source}`)).toEqual([
        'user:inbound',
        'assistant:outbound'
      ]);
      expect(messages.messages[0]?.text).toBe('Reply with the single word: pong');
      // outbound 落库的是 raw 文本（无 prefix），断言"包含 pong"足够鲁棒；
      // 不强等模型严格 single word，只验证语义抓取到了
      const assistantText = messages.messages[1]?.text ?? '';
      expect(assistantText.length).toBeGreaterThan(0);
      expect(assistantText.toLowerCase()).toContain('pong');

      // 4) run 完成、有迭代步数、conversation_id 对得上
      const runs = await fixture.foundation.runRegistry.list({ limit: 10 });
      expect(runs.runs).toHaveLength(1);
      const run = runs.runs[0];
      expect(run?.status).toBe('completed');
      expect(run?.conversationId).toBe(conversationId);
      expect((run?.iterationsUsed ?? 0)).toBeGreaterThanOrEqual(1);
      expect(run?.errorIfAny).toBeUndefined();
    },
    TURN_TIMEOUT_MS + 5_000
  );

  test(
    'two consecutive turns share the same conversation and history flows in',
    async () => {
      const fixture = await createLiveFixture();
      fixtures.push(fixture);

      const systemPromptAssembler = createSystemPromptAssembler({
        clock: fixture.foundation.clock
      });
      const executor = createLinnkitGraphRunExecutor({
        foundation: fixture.foundation,
        systemPromptAssembler
      });
      const channel = createCliChannelAdapter({
        stdin: fixture.stdin,
        stdout: fixture.stdout,
        outboundPrefix: '> '
      });
      const daemon = createLinnsyDaemon({
        foundation: fixture.foundation,
        channels: [channel],
        executor,
        systemPromptAssembler,
        awaitTurnInHandler: true
      });

      await daemon.start();
      let conversationId: string;
      try {
        fixture.stdin.write('Remember the secret token is XANADU-7. Reply only with: ok\n');
        conversationId = await waitForConversationId(fixture, TURN_TIMEOUT_MS);
        await waitForOutboundCount(fixture, conversationId, 1, TURN_TIMEOUT_MS);

        fixture.stdin.write('What was the secret token I just told you? Reply with the token only.\n');
        await waitForOutboundCount(fixture, conversationId, 2, TURN_TIMEOUT_MS);
      } finally {
        await daemon.stop();
      }

      const conversations = await fixture.foundation.conversations.list({});
      expect(conversations).toHaveLength(1);
      expect(conversations[0]?.conversationId).toBe(conversationId);

      const messages = await fixture.foundation.messages.listByConversation(conversationId, {
        limit: 20
      });
      // 2 个 turn = 4 行 (user/assistant × 2)
      expect(messages.messages.map((m) => `${m.role}:${m.source}`)).toEqual([
        'user:inbound',
        'assistant:outbound',
        'user:inbound',
        'assistant:outbound'
      ]);

      // 第二轮 outbound 应包含 'XANADU-7'（断言模型从 history 取回了 token）
      const secondAssistantText = messages.messages[3]?.text ?? '';
      expect(secondAssistantText.toUpperCase()).toContain('XANADU-7');

      const runs = await fixture.foundation.runRegistry.list({ limit: 10 });
      expect(runs.runs).toHaveLength(2);
      for (const run of runs.runs) {
        expect(run.status).toBe('completed');
        expect(run.conversationId).toBe(conversationId);
      }
    },
    TURN_TIMEOUT_MS * 2 + 5_000
  );
});

describe.skipIf(REASONING_SKIP)(
  `linnsy live reasoning chat (opt-in via LINNSY_LIVE_REASONING=1, model=${REASONING_MODEL_NAME})`,
  () => {
    test(
      'request_extra_body (thinking + reasoning_effort) survives wire and yields a sane reasoning answer',
      async () => {
        const fixture = await createLiveFixture(liveReasoningConfig);
        fixtures.push(fixture);

        const systemPromptAssembler = createSystemPromptAssembler({
          clock: fixture.foundation.clock
        });
        const executor = createLinnkitGraphRunExecutor({
          foundation: fixture.foundation,
          systemPromptAssembler
        });
        const channel = createCliChannelAdapter({
          stdin: fixture.stdin,
          stdout: fixture.stdout,
          outboundPrefix: '> '
        });
        const daemon = createLinnsyDaemon({
          foundation: fixture.foundation,
          channels: [channel],
          executor,
          systemPromptAssembler,
          awaitTurnInHandler: true
        });

        await daemon.start();
        const startedAt = Date.now();
        // 经典探针：要求模型给出 "9.8" 比 "9.11" 更大的明确判断；
        // 不思考的小模型经常答错，开 thinking 后正确率显著上升。
        fixture.stdin.write('Which is greater, 9.11 or 9.8? Answer with just the number.\n');

        const conversationId = await waitForConversationId(fixture, REASONING_TURN_TIMEOUT_MS);
        await waitForOutboundCount(fixture, conversationId, 1, REASONING_TURN_TIMEOUT_MS);
        const elapsedMs = Date.now() - startedAt;

        await daemon.stop();

        expect(elapsedMs).toBeLessThan(REASONING_RTT_BUDGET_MS);

        const messages = await fixture.foundation.messages.listByConversation(conversationId, {
          limit: 10
        });
        expect(messages.messages.map((m) => `${m.role}:${m.source}`)).toEqual([
          'user:inbound',
          'assistant:outbound'
        ]);
        const assistantText = messages.messages[1]?.text ?? '';
        expect(assistantText.length).toBeGreaterThan(0);
        // 模型可能输出 "9.8"、"9.80" 或带其他小修饰，但答案数字一定包含 "9.8"
        expect(assistantText).toContain('9.8');

        const runs = await fixture.foundation.runRegistry.list({ limit: 10 });
        expect(runs.runs).toHaveLength(1);
        expect(runs.runs[0]?.status).toBe('completed');
      },
      REASONING_TURN_TIMEOUT_MS + 5_000
    );
  }
);

async function waitForConversationId(fixture: LiveFixture, timeoutMs: number): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const conversations = await fixture.foundation.conversations.list({});
    if (conversations.length > 0 && conversations[0]?.conversationId !== undefined) {
      return conversations[0].conversationId;
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`live test waited ${String(timeoutMs)}ms for conversation row in DB`);
}

async function waitForOutboundCount(
  fixture: LiveFixture,
  conversationId: string,
  expected: number,
  timeoutMs: number
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const messages = await fixture.foundation.messages.listByConversation(conversationId, {
      limit: 50
    });
    const outbound = messages.messages.filter((m) => m.source === 'outbound');
    if (outbound.length >= expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  const messages = await fixture.foundation.messages.listByConversation(conversationId, { limit: 50 });
  const outbound = messages.messages.filter((m) => m.source === 'outbound');
  throw new Error(
    `live test waited ${String(timeoutMs)}ms for ${String(expected)} outbound message(s); saw ${String(outbound.length)}`
  );
}
