import type {
  OpenAIToolSchema,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolRuntimeDefinition,
  ToolRuntimePort
} from '@linnlabs/linnkit/runtime-kernel';

import type { LinnsyTool, StructuredToolResult, ToolRuntimeEventPort } from './types.js';
import type { ToolResultGuardPort } from './tool-result-guard.js';

export interface CreateLinnsyToolRuntimeOptions {
  tools?: LinnsyTool[];
  now?: () => number;
  resultGuard?: ToolResultGuardPort;
  // 注入后，每次 executeTool 会向前端推 tool_call.start / tool_call.result 事件。
  // 不注入时（如部分单测装配 / 早期启动期）静默跳过——保持 hub 不可用时也能跑通工具。
  events?: ToolRuntimeEventPort;
}

export function createLinnsyToolRuntime(options: CreateLinnsyToolRuntimeOptions = {}): ToolRuntimePort {
  const byName = new Map<string, LinnsyTool>();
  for (const tool of options.tools ?? []) {
    if (byName.has(tool.name)) {
      throw new Error(`duplicate tool ${tool.name}`);
    }
    byName.set(tool.name, tool);
  }
  const now = options.now ?? (() => Date.now());

  return {
    getToolSchemas(toolNames?: string[]): OpenAIToolSchema[] {
      const tools = toolNames === undefined
        ? [...byName.values()]
        : toolNames.map((name) => byName.get(name)).filter(isTool);
      return tools.map((tool) => tool.getSchema());
    },

    getToolDefinition(toolName: string): ToolRuntimeDefinition | undefined {
      return byName.get(toolName)?.definition;
    },

    getDisplayOptions() {
      return undefined;
    },

    async executeTool(
      toolName: string,
      args: Record<string, unknown>,
      context: ToolExecutionContext
    ): Promise<ToolExecutionResult> {
      const startedAt = now();
      const tool = byName.get(toolName);
      if (tool === undefined) {
        const durationMs = now() - startedAt;
        // 协议错误（工具未注册）：只发 tool_call.result，不发 start——
        // 因为没真正"开始执行"过；同时 toolCallId 可能未注入，用 fallback。
        publishToolResult(options.events, context, {
          toolName,
          status: 'error',
          error: `Tool ${toolName} is not registered`,
          errorKind: 'protocol',
          durationMs,
          endedAt: now()
        });
        return {
          success: false,
          error: `Tool ${toolName} is not registered`,
          errorKind: 'protocol',
          durationMs
        };
      }
      publishToolStart(options.events, context, { toolName, args, startedAt });
      try {
        const output: unknown = await tool.execute(args, context);
        assertStructuredToolResult(output, toolName);
        const result = options.resultGuard === undefined
          ? output.observation
          : await options.resultGuard.guard({
            toolName,
            observation: output.observation,
            data: output.data,
            context
          });
        const durationMs = now() - startedAt;
        publishToolResult(options.events, context, {
          toolName,
          status: 'success',
          data: output.data,
          observation: result,
          durationMs,
          endedAt: now()
        });
        return {
          success: true,
          result,
          durationMs
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const durationMs = now() - startedAt;
        publishToolResult(options.events, context, {
          toolName,
          status: 'error',
          error: message,
          errorKind: 'execution',
          durationMs,
          endedAt: now()
        });
        return {
          success: false,
          error: message,
          errorKind: 'execution',
          durationMs
        };
      }
    }
  };
}

// publish tool_call.start：args 此时已是 LLM 拼好交付的完整 Record。
function publishToolStart(
  events: ToolRuntimeEventPort | undefined,
  context: ToolExecutionContext,
  fields: { toolName: string; args: Record<string, unknown>; startedAt: number }
): void {
  if (events === undefined) return;
  const toolCallId = readToolCallId(context, fields.toolName, fields.startedAt);
  events.publish({
    kind: 'tool_call.start',
    ...(context.conversationId === undefined ? {} : { conversationId: context.conversationId }),
    ...(context.runId === undefined ? {} : { runId: context.runId }),
    createdAt: fields.startedAt,
    payload: {
      toolCallId,
      toolName: fields.toolName,
      args: fields.args,
      ...(context.turnId === undefined ? {} : { turnId: context.turnId }),
      startedAt: fields.startedAt
    }
  });
}

// publish tool_call.result：data 给前端渲染，observation 与 LLM 看到的 result 一致。
function publishToolResult(
  events: ToolRuntimeEventPort | undefined,
  context: ToolExecutionContext,
  fields: {
    toolName: string;
    status: 'success' | 'error' | 'blocked';
    data?: Record<string, unknown>;
    observation?: string;
    error?: string;
    errorKind?: 'protocol' | 'execution';
    durationMs: number;
    endedAt: number;
  }
): void {
  if (events === undefined) return;
  const toolCallId = readToolCallId(context, fields.toolName, fields.endedAt);
  events.publish({
    kind: 'tool_call.result',
    ...(context.conversationId === undefined ? {} : { conversationId: context.conversationId }),
    ...(context.runId === undefined ? {} : { runId: context.runId }),
    createdAt: fields.endedAt,
    payload: {
      toolCallId,
      toolName: fields.toolName,
      status: fields.status,
      ...(fields.data === undefined ? {} : { data: fields.data }),
      ...(fields.observation === undefined ? {} : { observation: fields.observation }),
      ...(fields.error === undefined ? {} : { error: fields.error }),
      ...(fields.errorKind === undefined ? {} : { errorKind: fields.errorKind }),
      durationMs: fields.durationMs,
      endedAt: fields.endedAt
    }
  });
}

// 从 ToolExecutionContext 取 tool_call_id；linnkit ToolNode 注入在 `parentToolCallId`
// 字段（命名是站在子 run 视角，对当前调用而言即为 toolCallId）。
// 异常路径（早期启动 / 测试夹具）可能没注入，用 toolName + timestamp 派生稳定 fallback。
function readToolCallId(context: ToolExecutionContext, toolName: string, timestamp: number): string {
  if (typeof context.parentToolCallId === 'string' && context.parentToolCallId.length > 0) {
    return context.parentToolCallId;
  }
  return `tc_local_${toolName}_${String(timestamp)}`;
}

function isTool(value: LinnsyTool | undefined): value is LinnsyTool {
  return value !== undefined;
}

function assertStructuredToolResult(output: unknown, toolName: string): asserts output is StructuredToolResult {
  if (!isRecord(output)) {
    throw new Error(`tool ${toolName} returned invalid StructuredToolResult`);
  }
  if (!isRecord(output.data)) {
    throw new Error(`tool ${toolName} returned invalid StructuredToolResult.data`);
  }
  if (typeof output.observation !== 'string' || output.observation.trim().length === 0) {
    throw new Error(`tool ${toolName} returned invalid StructuredToolResult.observation`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
