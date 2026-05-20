import { createLinnsyTaskStatusChangeFence } from '../context-engineering/fences.js';
import type { LinnsyNotificationLayer } from '../../../conversation/features/notification/types.js';
import type { TaskTerminalWakeEntry } from '../../../task/features/terminal-wake/definitions/types.js';
import {
  buildTaskTerminalWakeMetadata,
  buildTaskTransitionWakeQueryForEntries
} from '../../../task/features/terminal-wake/functions/task-wake-query.js';

import type { RunSpawnerPort } from './types.js';

export async function spawnWakeAndNotify(input: {
  entries: TaskTerminalWakeEntry[];
  spawner: Pick<RunSpawnerPort, 'spawnDetached' | 'waitForTerminal'>;
  agentId: string;
  notification?: Pick<LinnsyNotificationLayer, 'replyForTaskRun'>;
}): Promise<void> {
  const firstEntry = input.entries[0];
  if (firstEntry === undefined) {
    return;
  }
  const spawn = await input.spawner.spawnDetached({
    definitionKey: input.agentId,
    conversationId: firstEntry.task.conversationId,
    query: buildTaskTransitionWakeQueryForEntries(input.entries),
    contextFences: input.entries.map((entry) => createLinnsyTaskStatusChangeFence(entry.task)),
    wakeSource: 'task-completed',
    metadata: buildTaskTerminalWakeMetadata(input.entries)
  });

  if (input.notification === undefined) {
    return;
  }

  const terminal = await input.spawner.waitForTerminal(spawn.runId);
  const finalAnswer = terminal.type === 'completed' ? terminal.outcome.finalAnswer : undefined;
  if (finalAnswer === undefined || finalAnswer.trim().length === 0) {
    return;
  }
  await input.notification.replyForTaskRun({
    taskId: firstEntry.task.taskId,
    runId: spawn.runId,
    text: finalAnswer
  });
}
