import type {
  OpenAIToolSchema,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolRuntimeDefinition,
  ToolRuntimePort
} from '@linnlabs/linnkit/runtime-kernel';

import type { RunExecutorEventPort } from './types.js';

export interface PolicyScopedToolRuntimePort extends ToolRuntimePort {
  setAllowedToolIdsForRun(runId: string, toolIds: readonly string[]): void;
  clearAllowedToolIdsForRun(runId: string): void;
  runWithAllowedToolIdsForRun<T>(runId: string, toolIds: readonly string[], action: () => Promise<T>): Promise<T>;
  getToolSchemasForRun(runId: string): OpenAIToolSchema[];
}

export interface CreatePolicyScopedToolRuntimeOptions {
  // 注入后，策略禁止分支会推一条 status='blocked' 的 tool_call.result。
  events?: RunExecutorEventPort;
  now?: () => number;
}

export function createPolicyScopedToolRuntime(
  base: ToolRuntimePort,
  options: CreatePolicyScopedToolRuntimeOptions = {}
): PolicyScopedToolRuntimePort {
  const policies = new Map<string, Set<string>>();
  const now = options.now ?? (() => Date.now());

  function readPolicy(context: ToolExecutionContext): Set<string> | undefined {
    const runId = typeof context.runId === 'string' ? context.runId : undefined;
    return runId === undefined ? undefined : policies.get(runId);
  }

  return {
    getToolSchemas(toolNames?: string[]): OpenAIToolSchema[] {
      return base.getToolSchemas(toolNames);
    },

    getToolSchemasForRun(runId: string): OpenAIToolSchema[] {
      const policy = policies.get(runId);
      if (policy === undefined) {
        return base.getToolSchemas();
      }
      return base.getToolSchemas([...policy]);
    },

    getToolDefinition(toolName: string): ToolRuntimeDefinition | undefined {
      return base.getToolDefinition(toolName);
    },

    getDisplayOptions(toolName: string) {
      return base.getDisplayOptions(toolName);
    },

    executeTool(
      toolName: string,
      args: Record<string, unknown>,
      context: ToolExecutionContext
    ): Promise<ToolExecutionResult> {
      const policy = readPolicy(context);
      if (policy !== undefined && !policy.has(toolName)) {
        const endedAt = now();
        // 策略禁止：发 status='blocked' 的 result 给前端，让对话流能展示"Linnsy 想调 X，被策略拦了"。
        // 注意：这里不发 tool_call.start——因为根本没"开始执行"。
        if (options.events !== undefined) {
          const toolCallId = typeof context.parentToolCallId === 'string' && context.parentToolCallId.length > 0
            ? context.parentToolCallId
            : `tc_blocked_${toolName}_${String(endedAt)}`;
          options.events.publish({
            kind: 'tool_call.result',
            ...(context.conversationId === undefined ? {} : { conversationId: context.conversationId }),
            ...(context.runId === undefined ? {} : { runId: context.runId }),
            createdAt: endedAt,
            payload: {
              toolCallId,
              toolName,
              status: 'blocked',
              durationMs: 0,
              endedAt
            }
          });
        }
        return Promise.resolve({
          success: false,
          error: `Tool ${toolName} is not allowed for run ${String(context.runId)}`,
          errorKind: 'protocol',
          durationMs: 0
        });
      }
      return base.executeTool(toolName, args, context);
    },

    setAllowedToolIdsForRun(runId: string, toolIds: readonly string[]): void {
      policies.set(runId, new Set(toolIds));
    },

    clearAllowedToolIdsForRun(runId: string): void {
      policies.delete(runId);
    },

    async runWithAllowedToolIdsForRun<T>(
      runId: string,
      toolIds: readonly string[],
      action: () => Promise<T>
    ): Promise<T> {
      policies.set(runId, new Set(toolIds));
      try {
        return await action();
      } finally {
        policies.delete(runId);
      }
    }
  };
}
