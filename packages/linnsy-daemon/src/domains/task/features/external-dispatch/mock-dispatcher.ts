import type { TaskTrackerPort } from '../../ports/task-tracker-port.js';

import type {
  ExternalAgentCancelInput,
  ExternalAgentContinueInput,
  ExternalAgentDispatcherPort,
  ExternalAgentDispatchInput
} from './types.js';

export interface TimerFactory {
  setTimeout(callback: () => Promise<void>, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface CreateMockExternalAgentDispatcherOptions {
  taskTracker: TaskTrackerPort;
  timer?: TimerFactory;
  nodeSequence?: string[];
  nodeIntervalMs?: number;
  finalResult?: (input: ExternalAgentDispatchInput) => Record<string, unknown>;
}

const defaultTimer: TimerFactory = {
  setTimeout(callback, delayMs) {
    return globalThis.setTimeout(() => {
      void callback();
    }, delayMs);
  },
  clearTimeout(handle) {
    if (typeof handle === 'object' || typeof handle === 'number') {
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
    }
  }
};

export function createMockExternalAgentDispatcher(
  options: CreateMockExternalAgentDispatcherOptions
): ExternalAgentDispatcherPort {
  const timer = options.timer ?? defaultTimer;
  const nodeSequence = options.nodeSequence ?? ['queued', 'working', 'finalizing'];
  const nodeIntervalMs = options.nodeIntervalMs ?? 250;
  const finalResult = options.finalResult ?? ((input) => ({ ok: true, workspacePath: input.workspacePath }));
  const handlesByTaskId = new Map<string, unknown[]>();

  return {
    dispatch(input): Promise<void> {
      clearScheduledTimers(input.taskId, handlesByTaskId, timer);
      nodeSequence.forEach((node, index) => {
        schedule(input.taskId, handlesByTaskId, timer, async () => {
          await options.taskTracker.onExternalUpdate(input.taskId, {
            node,
            partialResult: { definitionKey: input.definitionKey }
          });
        }, index * nodeIntervalMs);
      });
      schedule(input.taskId, handlesByTaskId, timer, async () => {
        clearScheduledTimers(input.taskId, handlesByTaskId, timer);
        await options.taskTracker.onExternalUpdate(input.taskId, {
          node: 'completed',
          finalResult: finalResult(input)
        });
      }, nodeSequence.length * nodeIntervalMs);
      return Promise.resolve();
    },

    async continue(input: ExternalAgentContinueInput): Promise<void> {
      await options.taskTracker.onExternalUpdate(input.taskId, {
        node: 'continued',
        partialResult: {
          message: input.message,
          ...(input.payload === undefined ? {} : { payload: input.payload })
        }
      });
    },

    cancel(input: ExternalAgentCancelInput): Promise<void> {
      clearScheduledTimers(input.taskId, handlesByTaskId, timer);
      return Promise.resolve();
    }
  };
}

function schedule(
  taskId: string,
  handlesByTaskId: Map<string, unknown[]>,
  timer: TimerFactory,
  callback: () => Promise<void>,
  delayMs: number
): void {
  const handle = timer.setTimeout(callback, delayMs);
  const handles = handlesByTaskId.get(taskId) ?? [];
  handles.push(handle);
  handlesByTaskId.set(taskId, handles);
}

function clearScheduledTimers(
  taskId: string,
  handlesByTaskId: Map<string, unknown[]>,
  timer: TimerFactory
): void {
  const handles = handlesByTaskId.get(taskId) ?? [];
  for (const handle of handles) {
    timer.clearTimeout(handle);
  }
  handlesByTaskId.delete(taskId);
}
