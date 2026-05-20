import type { TaskRecord } from '../../../definitions/task.js';

export interface TaskExecutionNoticePayload {
  sourceKind: 'task_execution_notice';
  detail: string;
  refId: string;
  occurredAt: number;
}

export function buildTaskExecutionNoticePayload(task: TaskRecord): TaskExecutionNoticePayload | null {
  if (task.kind !== 'external' || task.status !== 'completed') {
    return null;
  }
  return {
    sourceKind: 'task_execution_notice',
    detail: `------ ${formatExternalAgentLabel(task)} 任务已执行 ------`,
    refId: task.taskId,
    occurredAt: task.updatedAt
  };
}

function formatExternalAgentLabel(task: TaskRecord): string {
  switch (task.externalKind) {
    case 'codex': return 'Codex';
    case 'claude_code': return 'Claude Code';
    case 'cursor': return 'Cursor';
    case 'chatgpt_web': return 'ChatGPT';
    case 'linnya': return 'Linnya';
    case 'mcp': return 'MCP';
    case 'manual': return '外部 agent';
    case undefined: return '外部 agent';
    default: return '外部 agent';
  }
}
