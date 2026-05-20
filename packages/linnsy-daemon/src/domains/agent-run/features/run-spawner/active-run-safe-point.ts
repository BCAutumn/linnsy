import type { runSupervisor } from '@linnlabs/linnkit/runtime-kernel';

import type { RuntimeEvent } from '../../../observability/definitions/runtime-events.js';

import type { RunSpawnerEventPort, RunSpawnerPort, RunStatus, RunTerminalEvent } from './types.js';

type LinnkitMemoryRunRegistryStore = InstanceType<typeof runSupervisor.MemoryRunRegistryStore>;
export type RunRecord = NonNullable<Awaited<ReturnType<LinnkitMemoryRunRegistryStore['load']>>>;
export type RunRegistryStore = Pick<LinnkitMemoryRunRegistryStore, 'list'>;

const ACTIVE_RUN_STATUSES: RunStatus[] = ['pending', 'running', 'awaiting_user'];

export async function findActiveMainRun(
  runRegistry: Pick<RunRegistryStore, 'list'>,
  conversationId: string
): Promise<RunRecord | null> {
  const page = await runRegistry.list({
    status: ACTIVE_RUN_STATUSES,
    limit: 100
  });
  return page.runs.find((run) => isForegroundRunForConversation(run, conversationId)) ?? null;
}

export async function waitForActiveRunSafePoint(input: {
  runId: string;
  spawner: Pick<RunSpawnerPort, 'waitForTerminal'>;
  events?: Pick<RunSpawnerEventPort, 'subscribe'>;
  activeRunReplyGraceMs: number;
}): Promise<void> {
  // waitForTerminal 只说明 AI 已经产出 finalAnswer；真正发到用户侧要等 message.complete。
  // 如果调用方没有接入事件总线，则用一个很短的 grace window 避免紧贴着主回复补发。
  const messageComplete = createRunMessageCompleteWaiter(input.runId, input.events);
  const terminal = await input.spawner.waitForTerminal(input.runId);
  if (!shouldWaitForRunReply(terminal)) {
    messageComplete.cancel();
    return;
  }
  try {
    await Promise.race([
      messageComplete.promise,
      delay(input.activeRunReplyGraceMs)
    ]);
  } finally {
    messageComplete.cancel();
  }
}

function isForegroundRunForConversation(run: RunRecord, conversationId: string): boolean {
  return run.conversationId === conversationId
    && run.parentRunId === undefined
    && run.metadata?.internalSubAgent !== true;
}

function createRunMessageCompleteWaiter(runId: string, events: Pick<RunSpawnerEventPort, 'subscribe'> | undefined): {
  promise: Promise<void>;
  cancel(): void;
} {
  if (events === undefined) {
    return {
      promise: Promise.resolve(),
      cancel() {}
    };
  }
  let unsubscribe: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    unsubscribe = events.subscribe((event) => {
      if (isMessageCompleteForRun(event, runId)) {
        unsubscribe?.();
        unsubscribe = undefined;
        resolve();
      }
    });
  });
  return {
    promise,
    cancel() {
      unsubscribe?.();
      unsubscribe = undefined;
    }
  };
}

function isMessageCompleteForRun(event: RuntimeEvent, runId: string): boolean {
  return event.kind === 'message.complete' && event.runId === runId;
}

function shouldWaitForRunReply(event: RunTerminalEvent): boolean {
  return event.type === 'completed' &&
    typeof event.outcome.finalAnswer === 'string' &&
    event.outcome.finalAnswer.trim().length > 0;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
