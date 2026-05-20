import type { TaskLocator } from '../../definitions/task.js';

export interface ExternalAgentDispatchInput {
  taskId: string;
  definitionKey: string;
  locator: TaskLocator;
  /** Vendor-specific task payload. Optional by contract; adapters must tolerate it being absent. */
  payload?: Record<string, unknown>;
  workspacePath: string;
}

export interface ExternalAgentContinueInput {
  taskId: string;
  message: string;
  payload?: Record<string, unknown>;
}

export interface ExternalAgentCancelInput {
  taskId: string;
  reason?: string;
}

export interface ExternalAgentDispatcherPort {
  dispatch(input: ExternalAgentDispatchInput): Promise<void>;
  // Phase 1 先让 port 具备"接着干"通道，具体 resume 语义留给 vendor adapter 消化。
  continue(input: ExternalAgentContinueInput): Promise<void>;
  // cancel 只负责通知外部执行器停止；task 状态仍由 task-tracker 统一维护。
  cancel(input: ExternalAgentCancelInput): Promise<void>;
}
