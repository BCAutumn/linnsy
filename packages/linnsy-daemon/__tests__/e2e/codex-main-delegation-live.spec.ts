/**
 * 真实主模型 dogfood：验证主对话模型会把明确的本地重活派给 Codex。
 *
 * 默认跳过，避免 CI 调真实模型。运行方式：
 *
 *   LINNSY_TEST_REAL_MAIN_CODEX=1 \
 *   LINNSY_LIVE_API_KEY_ENV=DEEPSEEK_API_KEY \
 *   LINNSY_LIVE_BASE_URL=https://api.deepseek.com \
 *   LINNSY_LIVE_MODEL=deepseek-chat \
 *   npm --prefix packages/linnsy-daemon test -- __tests__/e2e/codex-main-delegation-live.spec.ts
 *
 * 本测试只让主模型真实决策是否调用 delegate_to_external；Codex 侧仍用假可执行文件，
 * 这样可以把“主模型是否会派活”和“真实 Codex CLI 是否能完成任务”拆开验收。
 */

import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, test } from 'vitest';

import type { LinnsyConfig } from '../../src/config/schema.js';
import {
  createCliChannelAdapter,
  createCodexExecDispatcher,
  createDelegateToExternalTool,
  createLinnkitGraphRunExecutor,
  createLinnsyAgentRegistry,
  createLinnsyDaemon,
  createLinnsyRuntimeFoundation,
  createLinnsyToolRuntime,
  createRoutingExternalAgentDispatcher,
  createSystemPromptAssembler,
  createWorkspaceManager,
  type LinnsyRuntimeFoundation,
  type TaskRecord
} from '../../src/index.js';
import { createTempLinnsyHome } from '../harness/temp-home.js';

const LIVE_API_KEY_ENV = process.env.LINNSY_LIVE_API_KEY_ENV ??
  (process.env.DEEPSEEK_API_KEY === undefined ? 'OPENAI_API_KEY' : 'DEEPSEEK_API_KEY');
const LIVE_KEY = process.env[LIVE_API_KEY_ENV];
const RUN_REAL_MAIN_CODEX = process.env.LINNSY_TEST_REAL_MAIN_CODEX === '1';
const SKIP = !RUN_REAL_MAIN_CODEX || LIVE_KEY === undefined || LIVE_KEY.length === 0;
const USE_DEEPSEEK_DEFAULTS = LIVE_API_KEY_ENV === 'DEEPSEEK_API_KEY';

const LIVE_BASE_URL = process.env.LINNSY_LIVE_BASE_URL ??
  (USE_DEEPSEEK_DEFAULTS ? 'https://api.deepseek.com' : undefined);
const LIVE_MODEL_NAME = process.env.LINNSY_LIVE_MODEL ??
  (USE_DEEPSEEK_DEFAULTS ? 'deepseek-chat' : 'gpt-4o-mini');
const TURN_TIMEOUT_MS = 90_000;

interface DogfoodFixture {
  foundation: LinnsyRuntimeFoundation;
  home: string;
  stdin: PassThrough;
  stdout: PassThrough;
  stdoutChunks: string[];
  cleanup(): Promise<void>;
}

const fixtures: DogfoodFixture[] = [];

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    if (fixture !== undefined) {
      await fixture.cleanup();
    }
  }
});

describe.skipIf(SKIP)(`linnsy real main model codex delegation dogfood (${LIVE_MODEL_NAME})`, () => {
  test('CLI owner request -> real main model delegates to codex -> fake codex completes in a safe repo', async () => {
    const fixture = await createDogfoodFixture();
    fixtures.push(fixture);

    const projectPath = join(fixture.home, 'safe-codex-dogfood-project');
    const codexArgsPath = join(fixture.home, 'fake-codex-args.json');
    await mkdir(projectPath, { recursive: true });
    await writeFile(join(projectPath, 'smoke.txt'), 'before\n', 'utf8');
    const fakeCodexPath = await writeFakeCodexExecutable(fixture.home, codexArgsPath);

    const workspaceRoot = join(fixture.home, 'workspaces');
    const codexDispatcher = createCodexExecDispatcher({
      taskTracker: fixture.foundation.taskTracker,
      command: fakeCodexPath,
      sandbox: 'workspace-write'
    });
    const dispatcher = createRoutingExternalAgentDispatcher({
      taskTracker: fixture.foundation.taskTracker,
      routes: {
        delegate_to_codex: codexDispatcher
      }
    });
    const toolRuntime = createLinnsyToolRuntime({
      tools: [
        createDelegateToExternalTool({
          registry: createLinnsyAgentRegistry(),
          taskTracker: fixture.foundation.taskTracker,
          workspace: createWorkspaceManager({ root: workspaceRoot }),
          dispatcher
        })
      ]
    });
    const systemPromptAssembler = createSystemPromptAssembler({
      clock: fixture.foundation.clock
    });
    const executor = createLinnkitGraphRunExecutor({
      foundation: fixture.foundation,
      systemPromptAssembler,
      toolRuntime
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
      toolRuntime,
      systemPromptAssembler,
      awaitTurnInHandler: true
    });

    await daemon.start();
    try {
      // CLI 通道是一行一条 owner 消息；这里必须合成单行，避免多行输入触发多轮并发处理。
      fixture.stdin.write([
        '请让 Codex 处理一个本地小任务，不要你自己完成。',
        `项目目录是：${projectPath}。`,
        '任务：只修改 smoke.txt，把完整内容改成 linnsy main dogfood ok，然后简短汇报。'
      ].join(' ') + '\n');

      const task = await waitForCodexTask(fixture.foundation, TURN_TIMEOUT_MS);
      const smokeText = await readFile(join(projectPath, 'smoke.txt'), 'utf8');
      const capturedArgs = await readCapturedCodexArgs(codexArgsPath);
      const cliReply = await waitForStdoutContaining(fixture.stdoutChunks, '> ', TURN_TIMEOUT_MS);

      expect(task).toMatchObject({
        kind: 'external',
        externalKind: 'codex',
        status: 'completed',
        payload: {
          definitionKey: 'delegate_to_codex',
          cwd: projectPath
        }
      });
      expect(typeof task.payload?.prompt).toBe('string');
      expect(String(task.payload?.prompt)).toContain('smoke.txt');
      expect(smokeText).toBe('linnsy main dogfood ok\n');
      expect(capturedArgs).toContain('--json');
      expect(capturedArgs).toContain('--output-last-message');
      expect(capturedArgs.slice(0, 3)).toEqual(['exec', '--cd', projectPath]);
      expect(cliReply).toContain('> ');
    } finally {
      await daemon.stop();
    }
  }, TURN_TIMEOUT_MS + 10_000);
});

async function createDogfoodFixture(): Promise<DogfoodFixture> {
  const home = await createTempLinnsyHome();
  const foundation = createLinnsyRuntimeFoundation(liveConfig(home), {
    env: process.env
  });
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stdoutChunks: string[] = [];
  stdout.on('data', (chunk: Buffer) => {
    stdoutChunks.push(chunk.toString('utf8'));
  });

  return {
    foundation,
    home,
    stdin,
    stdout,
    stdoutChunks,
    async cleanup() {
      foundation.dispose();
      await rm(home, { recursive: true, force: true });
    }
  };
}

function liveConfig(home: string): LinnsyConfig {
  return {
    profile: 'codex-main-dogfood',
    home,
    llm: {
      default_provider: 'live',
      defaults: {
        secretary: 'live.main',
        cron_summary: 'live.main',
        memory_consolidate: 'live.main'
      },
      providers: {
        live: {
          api_protocol: 'openai_chat',
          api_key_env: LIVE_API_KEY_ENV,
          ...(LIVE_BASE_URL === undefined ? {} : { base_url: LIVE_BASE_URL }),
          models: {
            main: {
              model_name: LIVE_MODEL_NAME,
              capabilities: {
                context_window_tokens: 128_000,
                max_output_tokens: 4_096,
                supports_tools: true,
                supports_streaming: true
              },
              request_defaults: {
                temperature: 0,
                max_tokens: 512
              }
            }
          }
        }
      }
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

async function writeFakeCodexExecutable(root: string, argsPath: string): Promise<string> {
  const binDir = join(root, 'bin');
  const executablePath = join(binDir, 'fake-codex');
  await mkdir(binDir, { recursive: true });
  await writeFile(executablePath, [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    'const args = process.argv.slice(2);',
    `fs.writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(args), 'utf8');`,
    "const cwd = args[args.indexOf('--cd') + 1];",
    "const finalPath = args[args.indexOf('--output-last-message') + 1];",
    "fs.writeFileSync(path.join(cwd, 'smoke.txt'), 'linnsy main dogfood ok\\n', 'utf8');",
    "fs.writeFileSync(finalPath, 'fake codex completed smoke.txt', 'utf8');",
    "process.stdout.write(JSON.stringify({ type: 'session.started', session_id: 'dogfood_session' }) + '\\n');",
    "process.stdout.write(JSON.stringify({ type: 'response.completed', message: 'fake codex completed smoke.txt' }) + '\\n');"
  ].join('\n'), 'utf8');
  await chmod(executablePath, 0o755);
  return executablePath;
}

async function waitForCodexTask(foundation: LinnsyRuntimeFoundation, timeoutMs: number): Promise<TaskRecord> {
  const startedAt = Date.now();
  let lastSeenStatus = 'missing';
  while (Date.now() - startedAt <= timeoutMs) {
    const tasks = await foundation.taskTracker.list({ kind: 'external', limit: 10 });
    const task = tasks.find((item) => item.externalKind === 'codex');
    if (task !== undefined) {
      lastSeenStatus = task.status;
      if (task.status === 'completed') {
        return task;
      }
      if (task.status === 'failed') {
        throw new Error(`codex dogfood task failed: ${readTaskError(task)}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`waited ${String(timeoutMs)}ms for codex task completion; last status=${lastSeenStatus}`);
}

async function waitForStdoutContaining(chunks: readonly string[], text: string, timeoutMs: number): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const joined = chunks.join('');
    if (joined.includes(text)) {
      return joined;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`waited ${String(timeoutMs)}ms for CLI stdout to contain ${JSON.stringify(text)}`);
}

function readTaskError(task: TaskRecord): string {
  const errorMessage = task.result?.errorMessage;
  if (typeof errorMessage === 'string') {
    return errorMessage;
  }
  return errorMessage === undefined ? 'unknown error' : JSON.stringify(errorMessage);
}

async function readCapturedCodexArgs(path: string): Promise<string[]> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new Error('fake codex args must be a string array');
  }
  return parsed;
}
