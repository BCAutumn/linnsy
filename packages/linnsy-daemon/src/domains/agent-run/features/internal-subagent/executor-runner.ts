import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../shared/errors.js';
import type { ClockPort } from '../../../../shared/ports.js';
import { systemClock } from '../../../../shared/ports.js';
import type { TaskTrackerPort } from '../../../task/ports/task-tracker-port.js';

import type {
  InternalSubAgentExecutor,
  InternalSubAgentRunInput,
  InternalSubAgentRunner,
  InternalSubAgentRunnerStats
} from './types.js';
import { defaultScheduler, markFailed, persistTranscript, type Scheduler } from './shared.js';

export interface CreateInternalSubAgentExecutorRunnerOptions {
  taskTracker: TaskTrackerPort;
  executor: InternalSubAgentExecutor;
  maxConcurrency?: number;
  clock?: ClockPort;
  scheduler?: Scheduler;
}

export function createExecutorRunner(options: CreateInternalSubAgentExecutorRunnerOptions): InternalSubAgentRunner {
  const maxConcurrency = options.maxConcurrency ?? 4;
  const clock = options.clock ?? systemClock;
  const scheduler = options.scheduler ?? defaultScheduler;
  let activeCount = 0;

  return {
    spawn(input: InternalSubAgentRunInput): void {
      if (activeCount >= maxConcurrency) {
        throw new LinnsyError(
          LINNSY_ERROR_CODES.INTERNAL_AGENT_SPAWN_FAILED,
          `internal subagent concurrency limit reached (${String(maxConcurrency)})`,
          true
        );
      }
      activeCount += 1;
      scheduler(async () => {
        try {
          await options.taskTracker.transition(input.taskId, 'in_progress', { updatedAt: clock.now() });
          const output = await options.executor.execute(input);
          if (output.transcript !== undefined) {
            await persistTranscript(input, output.transcript);
          }
          await options.taskTracker.transition(input.taskId, 'completed', {
            result: output.result,
            lastNode: 'completed',
            completedAt: clock.now(),
            updatedAt: clock.now()
          });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          await markFailed(options.taskTracker, input.taskId, message, clock);
        } finally {
          activeCount -= 1;
        }
      });
    },
    getStats(): InternalSubAgentRunnerStats {
      return {
        activeCount,
        queuedCount: 0,
        maxConcurrency
      };
    }
  };
}
