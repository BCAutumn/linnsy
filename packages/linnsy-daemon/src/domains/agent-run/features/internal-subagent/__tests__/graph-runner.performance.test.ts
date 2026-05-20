import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AiMessage } from '@linnlabs/linnkit/contracts';
import type { AgentAiEngineStreamContent } from '@linnlabs/linnkit/ports';
import { afterEach, describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../../../../__tests__/harness/temp-home.js';
import type { LinnsyConfig } from '../../../../../config/schema.js';
import { FileToolResultStore } from '../../../../../persistence/stores/file-tool-result/file-tool-result-store.js';
import type {
  LinnsyLlmProvider,
  LinnsyProviderRouter
} from '../../../../llm/features/provider-routing/provider-router.js';
import { createLinnsyRuntimeFoundation } from '../../../../../app/bootstrap/foundation.js';
import { createLinnsyAgentRegistry } from '../../agents/registry/registry.js';
import { createLinnkitGraphRunExecutor } from '../../run-executor/linnkit-graph-executor.js';
import { createLinnsyRunSpawner } from '../../run-spawner/run-spawner.js';
import { createWakeOnTaskTransition } from '../../run-spawner/wake-on-task-transition.js';
import { createSystemPromptAssembler } from '../../system-prompt/system-prompt-assembler.js';
import { createToolResultGuard } from '../../tool-runtime/tool-result-guard.js';
import { createLinnsyToolRuntime } from '../../tool-runtime/tool-runtime.js';
import { createGetTaskStatusTool } from '../../tool-runtime/tools/get-task-status.js';
import { createListTasksTool } from '../../tool-runtime/tools/list-tasks.js';
import { createWorkspaceManager } from '../../../../task/features/workspace/workspace-manager.js';
import { createInternalSubAgentRunner } from '../runner.js';

interface Fixture {
  home: string;
  foundation: ReturnType<typeof createLinnsyRuntimeFoundation>;
}

class HoldingProviderRouter implements LinnsyProviderRouter {
  public readonly releases: HeldRelease[] = [];
  public readonly capturedMessages: AiMessage[][] = [];

  public resolve(): LinnsyLlmProvider {
    return {
      complete: (request) => {
        this.capturedMessages.push([...request.messages]);
        return Promise.resolve('child result');
      },
      stream: (request, callbacks) => {
        this.capturedMessages.push([...request.messages]);
        return new Promise<void>((resolve) => {
          this.releases.push({
            kind: classifyRunKind(request.messages),
            release: () => {
              callbacks.onContent?.('child result' satisfies AgentAiEngineStreamContent);
              callbacks.onFinish?.('stop');
              resolve();
            }
          });
        });
      }
    };
  }
}

interface HeldRelease {
  kind: 'child' | 'parent-wake' | 'other';
  release(): void;
}

const fixtures: Fixture[] = [];

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    if (fixture !== undefined) {
      fixture.foundation.dispose();
      await rm(fixture.home, { recursive: true, force: true });
    }
  }
});

describe('InternalSubAgentRunner graph-run performance boundary', () => {
  test('keeps ten real graph child runs active and queues the eleventh with bounded heap growth', async () => {
    const providerRouter = new HoldingProviderRouter();
    const home = await createTempLinnsyHome();
    const foundation = createLinnsyRuntimeFoundation(minimalConfig(home), { providerRouter });
    fixtures.push({ home, foundation });
    await foundation.conversations.upsert({
      conversationId: 'conv_parent',
      sessionKey: 'linnsy:main:cli:private:local',
      platform: 'cli',
      chatType: 'private',
      chatId: 'local',
      createdAt: 1,
      updatedAt: 1
    });
    const registry = createLinnsyAgentRegistry();
    const workspace = createWorkspaceManager({ root: join(home, 'workspaces') });
    const toolRuntime = createLinnsyToolRuntime({
      resultGuard: createToolResultGuard({ store: new FileToolResultStore() }),
      tools: [
        createListTasksTool({ taskTracker: foundation.taskTracker }),
        createGetTaskStatusTool({ taskTracker: foundation.taskTracker })
      ]
    });
    const executor = createLinnkitGraphRunExecutor({
      foundation,
      systemPromptAssembler: createSystemPromptAssembler({ clock: foundation.clock }),
      toolRuntime
    });
    const spawner = createLinnsyRunSpawner({
      registry,
      conversations: foundation.conversations,
      runRegistry: foundation.runRegistry,
      executor,
      auditPort: foundation.auditPort,
      clock: foundation.clock,
      logger: foundation.logger
    });
    foundation.attachTaskWakeHook(createWakeOnTaskTransition({
      spawner,
      runRegistry: foundation.runRegistry
    }));
    const runner = createInternalSubAgentRunner({
      taskTracker: foundation.taskTracker,
      conversations: foundation.conversations,
      spawner,
      maxConcurrency: 10,
      clock: foundation.clock
    });
    const beforeHeap = process.memoryUsage().heapUsed;

    for (let index = 1; index <= 11; index += 1) {
      const taskId = `task_graph_${index.toString()}`;
      const workspacePath = await workspace.create(taskId);
      await foundation.taskTracker.upsert({
        taskId,
        conversationId: 'conv_parent',
        title: `graph task ${index.toString()}`,
        status: 'dispatched',
        kind: 'internal_subagent',
        workspacePath,
        payload: {
          definitionKey: 'linnsy_general_subagent',
          goal: `graph task ${index.toString()}`
        }
      });
      runner.spawn({
        taskId,
        definitionKey: 'linnsy_general_subagent',
        goal: `graph task ${index.toString()}`,
        context: 'short explicit context',
        workspacePath,
        parentConversationId: 'conv_parent',
        parentRunId: 'run_parent'
      });
    }

    await waitFor(() => countHeld(providerRouter, 'child') === 10, 'ten child graph runs to enter the LLM provider');
    expect(runner.getStats()).toEqual({
      activeCount: 10,
      queuedCount: 1,
      maxConcurrency: 10
    });
    expect(process.memoryUsage().heapUsed - beforeHeap).toBeLessThan(128 * 1024 * 1024);

    releaseHeld(providerRouter, 'child');
    await waitFor(() => countHeld(providerRouter, 'child') === 1, 'queued child graph run to start');
    releaseHeld(providerRouter, 'child');
    await waitFor(async () => {
      const tasks = await foundation.taskTracker.list({
        kind: 'internal_subagent',
        status: ['completed'],
        limit: 20
      });
      return tasks.length === 11;
    }, 'all child tasks to complete');

    expect(runner.getStats()).toEqual({
      activeCount: 0,
      queuedCount: 0,
      maxConcurrency: 10
    });
    await waitFor(() => countHeld(providerRouter, 'parent-wake') === 1, 'first parent wake graph run to enter the LLM provider');
    releaseHeld(providerRouter, 'parent-wake');
    await waitFor(() => countHeld(providerRouter, 'parent-wake') === 1, 'batched deferred parent wake graph run to enter the LLM provider');
    releaseHeld(providerRouter, 'parent-wake');
    await spawner.drain();
  });
});

function classifyRunKind(messages: AiMessage[]): HeldRelease['kind'] {
  const text = messages
    .map((message) => typeof message.content === 'string' ? message.content : '')
    .join('\n');
  if (text.includes('child result') && !text.includes('Goal:\ngraph task')) {
    return 'parent-wake';
  }
  if (text.includes('Goal:\ngraph task')) {
    return 'child';
  }
  return 'other';
}

function countHeld(router: HoldingProviderRouter, kind: HeldRelease['kind']): number {
  return router.releases.filter((entry) => entry.kind === kind).length;
}

function releaseHeld(router: HoldingProviderRouter, kind: HeldRelease['kind']): void {
  for (let index = router.releases.length - 1; index >= 0; index -= 1) {
    const entry = router.releases[index];
    if (entry?.kind !== kind) {
      continue;
    }
    router.releases.splice(index, 1);
    entry.release();
  }
}

async function waitFor(condition: () => boolean | Promise<boolean>, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

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
      pairing: { code_ttl_ms: 600000, max_attempts: 5 }
    },
    cron: { tick_interval_ms: 60000, default_miss_grace_ms: 7200000 },
    memory: { on_pre_compress_provider: 'builtin' },
    mcp: { server: { enabled: true, transport: 'stdio' }, clients: [] }
  };
}
