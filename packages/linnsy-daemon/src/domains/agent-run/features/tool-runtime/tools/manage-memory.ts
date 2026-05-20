import { randomUUID } from 'node:crypto';

import type { OpenAIToolSchema, ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';

import type { MemoryProviderPort } from '../../../../memory/persistence/memory-store-port.js';
import { MEMORY_ERROR_CODES } from '../../../../memory/persistence/memory-store-port.js';
import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../shared/errors.js';
import { toJsonObjectSchema, type LinnsyTool, type StructuredToolResult } from '../types.js';

const MAX_MEMORY_BODY_BYTES = 4 * 1024;
const AGENT_ID = 'linnsy_main';

type MemoryOperation = 'set' | 'forget';
type WritableMemoryScope = 'long_term_memory' | 'user_preference';

export interface ManageMemoryOutput extends Record<string, unknown> {
  op: MemoryOperation;
  memoryId: string;
  scope?: WritableMemoryScope;
  body?: string;
}

export interface CreateManageMemoryToolOptions {
  memoryStore: MemoryProviderPort;
  now?: () => number;
  memoryIdFactory?: (scope: WritableMemoryScope) => string;
}

export interface ManageMemoryTool extends Omit<LinnsyTool, 'execute'> {
  execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<StructuredToolResult<ManageMemoryOutput>>;
}

export function createManageMemoryTool(options: CreateManageMemoryToolOptions): ManageMemoryTool {
  const now = options.now ?? (() => Date.now());
  const memoryIdFactory = options.memoryIdFactory ?? defaultMemoryIdFactory;

  return {
    name: 'manage_memory',
    description: 'Write or forget owner-approved long-term memory and user preferences. Only long_term_memory and user_preference are writable.',
    definition: {
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          op: { type: 'string', enum: ['set', 'forget'], description: 'Operation to perform: set or forget.' },
          scope: {
            type: 'string',
            enum: ['long_term_memory', 'user_preference'],
            description: 'Writable memory scope. Only long_term_memory and user_preference are allowed.'
          },
          body: {
            type: 'string',
            description: 'Stable memory text approved by the owner. Maximum 4KB after trimming.'
          },
          memoryId: {
            type: 'string',
            description: 'Existing memory id to overwrite or forget. Do not use builtin ids.'
          }
        },
        required: ['op']
      }
    },
    getSchema(): OpenAIToolSchema {
      return {
        type: 'function',
        function: {
          name: this.name,
          description: this.description,
          parameters: toJsonObjectSchema(this.definition.parameters)
        }
      };
    },
    async execute(args, context): Promise<StructuredToolResult<ManageMemoryOutput>> {
      const op = readOperation(args.op);
      if (op === 'set') {
        return setMemory({
          args,
          context,
          memoryStore: options.memoryStore,
          now,
          memoryIdFactory
        });
      }
      return forgetMemory({
        args,
        memoryStore: options.memoryStore
      });
    }
  };
}

async function setMemory(input: {
  args: Record<string, unknown>;
  context: ToolExecutionContext;
  memoryStore: MemoryProviderPort;
  now: () => number;
  memoryIdFactory: (scope: WritableMemoryScope) => string;
}): Promise<StructuredToolResult<ManageMemoryOutput>> {
  const scope = readWritableScope(input.args.scope);
  const body = readMemoryBody(input.args.body);
  const providedMemoryId = readOptionalMemoryId(input.args.memoryId);
  if (providedMemoryId !== undefined) {
    assertNotBuiltinMemoryId(providedMemoryId);
  }
  const memoryId = providedMemoryId ?? input.memoryIdFactory(scope);
  assertNotBuiltinMemoryId(memoryId);

  const item = await input.memoryStore.upsert({
    memoryId,
    scope,
    body,
    metadata: createAgentToolMetadata(input.context, input.now())
  });

  return {
    data: {
      op: 'set',
      memoryId: item.memoryId,
      scope,
      body: item.body
    },
    observation: `已记住：${item.body}（memoryId=${item.memoryId}）。`
  };
}

async function forgetMemory(input: {
  args: Record<string, unknown>;
  memoryStore: MemoryProviderPort;
}): Promise<StructuredToolResult<ManageMemoryOutput>> {
  const memoryId = readRequiredMemoryId(input.args.memoryId);
  assertNotBuiltinMemoryId(memoryId);
  const removed = await input.memoryStore.remove(memoryId);
  if (!removed) {
    throw new LinnsyError(
      MEMORY_ERROR_CODES.ITEM_NOT_FOUND,
      `memory item ${memoryId} was not found`,
      false
    );
  }

  return {
    data: {
      op: 'forget',
      memoryId
    },
    observation: `已删除记忆 ${memoryId}。`
  };
}

function createAgentToolMetadata(context: ToolExecutionContext, writtenAt: number): Record<string, unknown> {
  return {
    source: 'agent_tool',
    writtenByAgent: AGENT_ID,
    ...(context.conversationId === undefined ? {} : { writtenAtConversationId: context.conversationId }),
    ...(context.runId === undefined ? {} : { writtenAtRunId: context.runId }),
    writtenAt
  };
}

function readOperation(value: unknown): MemoryOperation {
  if (value === 'set' || value === 'forget') {
    return value;
  }
  throw new LinnsyError(
    MEMORY_ERROR_CODES.ITEM_INVALID,
    'manage_memory op must be set or forget',
    false
  );
}

function readWritableScope(value: unknown): WritableMemoryScope {
  if (value === 'long_term_memory' || value === 'user_preference') {
    return value;
  }
  throw new LinnsyError(
    LINNSY_ERROR_CODES.MEMORY_SCOPE_NOT_WRITABLE,
    'manage_memory scope must be long_term_memory or user_preference',
    false
  );
}

function readMemoryBody(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new LinnsyError(
      MEMORY_ERROR_CODES.ITEM_INVALID,
      'manage_memory body must be a non-empty string',
      false
    );
  }
  const body = value.trim();
  if (Buffer.byteLength(body, 'utf8') > MAX_MEMORY_BODY_BYTES) {
    throw new LinnsyError(
      LINNSY_ERROR_CODES.MEMORY_BODY_TOO_LARGE,
      `manage_memory body must be at most ${String(MAX_MEMORY_BODY_BYTES)} bytes`,
      false
    );
  }
  return body;
}

function readOptionalMemoryId(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return readRequiredMemoryId(value);
}

function readRequiredMemoryId(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new LinnsyError(
      MEMORY_ERROR_CODES.ITEM_NOT_FOUND,
      'manage_memory memoryId must be a non-empty string',
      false
    );
  }
  return value.trim();
}

function assertNotBuiltinMemoryId(memoryId: string): void {
  if (!memoryId.startsWith('builtin:')) {
    return;
  }
  throw new LinnsyError(
    LINNSY_ERROR_CODES.MEMORY_BUILTIN_PROTECTED,
    `memory item ${memoryId} is builtin and cannot be changed by manage_memory`,
    false
  );
}

function defaultMemoryIdFactory(scope: WritableMemoryScope): string {
  const prefix = scope === 'long_term_memory' ? 'ltm' : 'pref';
  return `${prefix}_${randomUUID()}`;
}
