import type { runSupervisor } from '@linnlabs/linnkit/runtime-kernel';
import { describe, expect, test } from 'vitest';

import { LINNSY_FENCE_KINDS } from '../../context-engineering/fences.js';
import type { LinnsyNotificationLayer } from '../../../../conversation/features/notification/types.js';
import type { TaskRecord } from '../../../../task/definitions/task.js';
import { buildTaskTransitionWakeQuery } from '../../../../task/features/terminal-wake/functions/task-wake-query.js';
import type { RuntimeEvent, RuntimeEventPublishInput } from '../../../../observability/definitions/runtime-events.js';
import type { RunSpawnerEventPort, RunTerminalEvent, SpawnOptions, SpawnResult } from '../types.js';
import { createWakeOnTaskTransition } from '../wake-on-task-transition.js';

type LinnkitMemoryRunRegistryStore = InstanceType<typeof runSupervisor.MemoryRunRegistryStore>;
type RunRecord = NonNullable<Awaited<ReturnType<LinnkitMemoryRunRegistryStore['load']>>>;

class FakeSpawner {
  public readonly spawned: SpawnOptions[] = [];
  public readonly terminalByRunId = new Map<string, RunTerminalEvent>();

  public spawnDetached(options: SpawnOptions): Promise<SpawnResult> {
    this.spawned.push(options);
    const runId = `run_${this.spawned.length.toString()}`;
    this.terminalByRunId.set(runId, {
      runId,
      type: 'completed',
      outcome: { status: 'completed', finalAnswer: `wake:${options.query}` }
    });
    return Promise.resolve({ runId, conversationId: options.conversationId });
  }

  public waitForTerminal(runId: string): Promise<RunTerminalEvent> {
    const terminal = this.terminalByRunId.get(runId);
    if (terminal === undefined) {
      return Promise.resolve({
        runId,
        type: 'completed',
        outcome: { status: 'completed', finalAnswer: 'active done' }
      });
    }
    return Promise.resolve(terminal);
  }
}

class FakeRunRegistry {
  public runs: RunRecord[] = [];

  public list(): Promise<{ runs: RunRecord[] }> {
    return Promise.resolve({ runs: this.runs });
  }
}

class FakeEventHub implements RunSpawnerEventPort {
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  private seq = 0;

  public publish(input: RuntimeEventPublishInput): RuntimeEvent {
    this.seq += 1;
    const base = {
      eventId: `evt_${this.seq.toString()}`,
      seq: this.seq,
      createdAt: 1_000 + this.seq,
      ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
      ...(input.messageId === undefined ? {} : { messageId: input.messageId }),
      ...(input.runId === undefined ? {} : { runId: input.runId })
    };
    const event = buildRuntimeEventForTest(input, base);
    for (const listener of this.listeners) {
      listener(event);
    }
    return event;
  }

  public subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

interface RuntimeEventBaseForTest {
  eventId: string;
  seq: number;
  createdAt: number;
  conversationId?: string;
  messageId?: string;
  runId?: string;
}

function buildRuntimeEventForTest(input: RuntimeEventPublishInput, base: RuntimeEventBaseForTest): RuntimeEvent {
  switch (input.kind) {
    case 'message.complete':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'system.event':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'message.inbound':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'message.delta':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'message.thought_delta':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'message.thought_complete':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'run.status_change':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'tool_call.start':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'tool_call.progress':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'tool_call.result':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'subagent.progress':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'subagent.summary':
      return { ...base, kind: input.kind, payload: input.payload };
  }
}

describe('createWakeOnTaskTransition', () => {
  test('defers spawning when a foreground main run is already active in the conversation', async () => {
    const spawner = new FakeSpawner();
    const runRegistry = new FakeRunRegistry();
    const events = new FakeEventHub();
    const notification = new FakeNotification();
    runRegistry.runs = [{
      runId: 'run_active',
      conversationId: 'conv_1',
      status: 'running',
      startedAt: 1,
      updatedAt: 1
    }];
    const hook = createWakeOnTaskTransition({
      spawner,
      runRegistry,
      notification,
      events,
      activeRunReplyGraceMs: 1
    });

    await hook({ task: taskRecord({ status: 'completed' }), fromStatus: 'in_progress' });

    expect(spawner.spawned).toEqual([]);
    runRegistry.runs = [];
    events.publish({
      kind: 'message.complete',
      conversationId: 'conv_1',
      runId: 'run_active',
      payload: {
        message: {
          messageId: 'out_active',
          conversationId: 'conv_1',
          role: 'assistant',
          source: 'outbound',
          text: '旧回复',
          createdAt: 2
        }
      }
    });
    await flushMicrotasks();

    expect(spawner.spawned).toEqual([
      expect.objectContaining({
        definitionKey: 'linnsy_main',
        conversationId: 'conv_1',
        wakeSource: 'task-completed'
      })
    ]);
    expect(notification.replies).toHaveLength(1);
    expect(notification.replies[0]).toMatchObject({ taskId: 'task_1', runId: 'run_1' });
    expect(notification.replies[0]?.text).toContain('wake:Task 修复测试 reached terminal status: completed.');
  });

  test('ignores active internal child runs and wakes linnsy_main with a system-event fence', async () => {
    const spawner = new FakeSpawner();
    const runRegistry = new FakeRunRegistry();
    runRegistry.runs = [{
      runId: 'run_child',
      conversationId: 'conv_1',
      parentRunId: 'run_parent',
      status: 'running',
      metadata: { internalSubAgent: true },
      startedAt: 1,
      updatedAt: 1
    }];
    const task = taskRecord({
      status: 'completed',
      result: { finalMessage: '完成第一步，要不要继续第二步' }
    });
    const hook = createWakeOnTaskTransition({ spawner, runRegistry });

    await hook({ task, fromStatus: 'in_progress' });

    expect(spawner.spawned).toEqual([
      expect.objectContaining({
        definitionKey: 'linnsy_main',
        conversationId: 'conv_1',
        query: buildTaskTransitionWakeQuery(task),
        wakeSource: 'task-completed',
        metadata: {
          taskId: 'task_1',
          fromStatus: 'in_progress',
          toStatus: 'completed'
        },
        contextFences: [
          {
            kind: LINNSY_FENCE_KINDS.systemEvent,
            content: '完成第一步，要不要继续第二步',
            attrs: {
              kind: 'task_status_change',
              taskId: 'task_1',
              vendor: 'codex',
              status: 'completed',
              locator: 'linnsy(/Users/tiansi/code/linnsy)',
              finalMessage: '完成第一步，要不要继续第二步'
            }
          }
        ]
      })
    ]);
  });

  test('publishes a lightweight execution notice for completed external tasks', async () => {
    const spawner = new FakeSpawner();
    const runRegistry = new FakeRunRegistry();
    const events = new FakeEventHub();
    const systemEvents: RuntimeEvent[] = [];
    events.subscribe((event) => {
      if (event.kind === 'system.event') {
        systemEvents.push(event);
      }
    });
    const hook = createWakeOnTaskTransition({ spawner, runRegistry, events });

    await hook({ task: taskRecord({ status: 'completed' }), fromStatus: 'in_progress' });

    expect(systemEvents).toEqual([
      expect.objectContaining({
        conversationId: 'conv_1',
        payload: {
          sourceKind: 'task_execution_notice',
          detail: '------ Codex 任务已执行 ------',
          refId: 'task_1',
          occurredAt: 2_000
        }
      })
    ]);
  });

  test.each([
    {
      status: 'failed' as const,
      result: { errorMessage: 'codex exec failed' },
      expectedContent: 'codex exec failed',
      expectedAttr: { errorMessage: 'codex exec failed' }
    },
    {
      status: 'cancelled' as const,
      cancelReason: 'owner_cancelled',
      expectedContent: 'owner_cancelled',
      expectedAttr: { cancelReason: 'owner_cancelled' }
    }
  ])('wakes for $status task terminal state', async (input) => {
    const spawner = new FakeSpawner();
    const runRegistry = new FakeRunRegistry();
    const hook = createWakeOnTaskTransition({ spawner, runRegistry });

    await hook({
      task: taskRecord({
        status: input.status,
        ...(input.result === undefined ? {} : { result: input.result }),
        ...(input.cancelReason === undefined ? {} : { cancelReason: input.cancelReason })
      }),
      fromStatus: 'in_progress'
    });

    expect(spawner.spawned[0]?.contextFences?.[0]).toMatchObject({
      kind: LINNSY_FENCE_KINDS.systemEvent,
      content: input.expectedContent,
      attrs: {
        kind: 'task_status_change',
        taskId: 'task_1',
        vendor: 'codex',
        status: input.status,
        ...input.expectedAttr
      }
    });
  });

  test('builds a short wake query without embedding the final message', () => {
    const task = taskRecord({
      status: 'completed',
      result: { finalMessage: 'very long worker result' }
    });

    expect(buildTaskTransitionWakeQuery(task)).toContain('Task 修复测试 reached terminal status: completed.');
    expect(buildTaskTransitionWakeQuery(task)).not.toContain('very long worker result');
  });
});

class FakeNotification implements Pick<LinnsyNotificationLayer, 'replyForTaskRun'> {
  public readonly replies: Array<{ taskId: string; runId: string; text: string }> = [];

  public replyForTaskRun(input: { taskId: string; runId: string; text: string }): Promise<{
    outboundMessageId: string;
    delivery: 'sent';
  }> {
    this.replies.push(input);
    return Promise.resolve({ outboundMessageId: `out_${this.replies.length.toString()}`, delivery: 'sent' });
  }
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function taskRecord(patch: Partial<TaskRecord>): TaskRecord {
  return {
    taskId: 'task_1',
    conversationId: 'conv_1',
    kind: 'external',
    attemptCount: 1,
    externalKind: 'codex',
    locator: {
      kind: 'directory',
      label: 'linnsy',
      ref: '/Users/tiansi/code/linnsy'
    },
    title: '修复测试',
    status: 'in_progress',
    createdAt: 1_000,
    updatedAt: 2_000,
    ...patch
  };
}
