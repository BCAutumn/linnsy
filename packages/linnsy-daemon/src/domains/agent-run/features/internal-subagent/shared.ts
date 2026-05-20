import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../shared/errors.js';
import type { ClockPort } from '../../../../shared/ports.js';
import type { TaskTrackerPort } from '../../../task/ports/task-tracker-port.js';

import type { InternalSubAgentRunInput } from './types.js';

export type Scheduler = (callback: () => Promise<void>) => void;

export function defaultScheduler(callback: () => Promise<void>): void {
  setTimeout(() => {
    void callback();
  }, 0);
}

export async function persistTranscript(input: InternalSubAgentRunInput, transcript: string): Promise<void> {
  const transcriptsDir = join(input.workspacePath, 'transcripts');
  await mkdir(transcriptsDir, { recursive: true, mode: 0o700 });
  await writeFile(join(transcriptsDir, `${input.taskId}.txt`), `${transcript}\n`, { mode: 0o600 });
}

export async function markFailed(
  taskTracker: TaskTrackerPort,
  taskId: string,
  message: string,
  clock: ClockPort
): Promise<void> {
  const task = await taskTracker.get(taskId);
  if (task === null || task.status === 'failed' || task.status === 'completed') {
    return;
  }
  if (task.status === 'dispatched') {
    await taskTracker.transition(taskId, 'in_progress', { updatedAt: clock.now() });
  }
  await taskTracker.transition(taskId, 'failed', {
    result: { errorMessage: message },
    lastNode: 'failed',
    updatedAt: clock.now()
  });
}

export function readParentConversationId(input: InternalSubAgentRunInput): string {
  if (input.parentConversationId !== undefined && input.parentConversationId.trim().length > 0) {
    return input.parentConversationId;
  }
  throw new LinnsyError(
    LINNSY_ERROR_CODES.INTERNAL_AGENT_SPAWN_FAILED,
    `internal subagent ${input.taskId} is missing parentConversationId`,
    false
  );
}
