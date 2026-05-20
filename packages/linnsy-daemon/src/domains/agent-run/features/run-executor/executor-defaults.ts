import type {
  ObservationPreviewPort,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolRuntimeDefinition,
  ToolRuntimePort
} from '@linnlabs/linnkit/runtime-kernel';

export function createEmptyToolRuntime(): ToolRuntimePort {
  return {
    getToolSchemas() {
      return [];
    },
    getToolDefinition(): ToolRuntimeDefinition | undefined {
      return undefined;
    },
    getDisplayOptions() {
      return undefined;
    },
    executeTool(
      toolName: string,
      args: Record<string, unknown>,
      context: ToolExecutionContext
    ): Promise<ToolExecutionResult> {
      void args;
      void context;
      return Promise.resolve({
        success: false,
        error: `Tool ${toolName} is not registered in S1`,
        errorKind: 'protocol',
        durationMs: 0
      });
    }
  };
}

export function createPassthroughObservationPreview(): ObservationPreviewPort {
  return {
    truncateObservation(params) {
      if (params.text.length <= params.maxChars) {
        return Promise.resolve({ truncated: false, preview: params.text });
      }
      return Promise.resolve({
        truncated: true,
        preview: params.text.slice(0, params.maxChars),
        blob_id: `${params.toolName}:truncated`
      });
    }
  };
}
