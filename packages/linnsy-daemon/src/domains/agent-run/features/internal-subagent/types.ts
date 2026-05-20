import type {
  RuntimeEvent,
  RuntimeEventPublishInput
} from '../../../observability/definitions/runtime-events.js';

export type InternalSubAgentSummaryEventInput = Extract<
  RuntimeEventPublishInput,
  { kind: 'subagent.summary' }
>;

export interface InternalSubAgentEventPort {
  publish(input: InternalSubAgentSummaryEventInput): RuntimeEvent;
}

export interface InternalSubAgentRunInput {
  taskId: string;
  definitionKey: string;
  goal: string;
  context?: string;
  workspacePath: string;
  parentConversationId?: string;
  parentRunId?: string;
}

export interface InternalSubAgentRunResult {
  result: Record<string, unknown>;
  transcript?: string;
}

export interface InternalSubAgentExecutor {
  execute(input: InternalSubAgentRunInput): Promise<InternalSubAgentRunResult>;
}

export interface InternalSubAgentRunner {
  spawn(input: InternalSubAgentRunInput): void;
  getStats(): InternalSubAgentRunnerStats;
}

export interface InternalSubAgentRunnerStats {
  activeCount: number;
  queuedCount: number;
  maxConcurrency: number;
}
