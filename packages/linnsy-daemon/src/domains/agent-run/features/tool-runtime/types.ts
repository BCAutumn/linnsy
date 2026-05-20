import type {
  JsonObjectSchema,
  OpenAIToolSchema,
  ToolExecutionContext,
  ToolRuntimeDefinition
} from '@linnlabs/linnkit/runtime-kernel';

import type {
  RuntimeEvent,
  RuntimeEventPublishInput
} from '../../../observability/definitions/runtime-events.js';

export interface StructuredToolResult<TData extends Record<string, unknown> = Record<string, unknown>> {
  data: TData;
  observation: string;
}

export interface ToolRuntimeEventPort {
  publish(input: RuntimeEventPublishInput): RuntimeEvent;
}

export interface LinnsyTool {
  readonly name: string;
  readonly description: string;
  readonly definition: ToolRuntimeDefinition;
  getSchema(): OpenAIToolSchema;
  execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<StructuredToolResult>;
}

export function toJsonObjectSchema(parameters: ToolRuntimeDefinition['parameters']): JsonObjectSchema {
  return {
    type: parameters.type,
    properties: parameters.properties,
    ...(parameters.required === undefined ? {} : { required: parameters.required }),
    ...(parameters.additionalProperties === undefined
      ? {}
      : { additionalProperties: parameters.additionalProperties })
  };
}
