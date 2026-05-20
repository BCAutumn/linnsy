import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { LinnsyError } from '../../../../shared/errors.js';
import {
  MEMORY_ERROR_CODES,
  type MemoryProviderPort,
  type MemoryUpsertInput
} from '../../persistence/memory-store-port.js';

export interface CreateMemoryRoutesOptions {
  store: MemoryProviderPort;
  systemPromptPreview?: () => Promise<unknown>;
  afterMutation?: () => void;
}

const memoryWriteSchema = z
  .object({
    scope: z.string().min(1),
    body: z.string().min(1),
    conversationId: z.string().min(1).optional(),
    expiresAt: z.number().int().positive().optional(),
    metadata: z.record(z.unknown()).optional()
  })
  .strict();

export function createMemoryRoutes(options: CreateMemoryRoutesOptions): Hono {
  const app = new Hono();

  app.get('/api/v1/memory/items', async (context) => {
    const query = context.req.query('query');
    const scope = context.req.query('scope');
    const limit = parseOptionalInteger(context.req.query('limit'));
    const items = await options.store.list({
      ...(query === undefined ? {} : { query }),
      ...(scope === undefined ? {} : { scope }),
      ...(limit === undefined ? {} : { limit })
    });
    return context.json({ ok: true, items });
  });

  app.get('/api/v1/memory/system-prompt-preview', async (context) => {
    if (options.systemPromptPreview === undefined) {
      return context.json({
        ok: false,
        code: 'LINNSY_MEMORY_SYSTEM_PROMPT_PREVIEW_UNAVAILABLE',
        message: 'system prompt preview is not available'
      }, 500);
    }
    const preview = await options.systemPromptPreview();
    return context.json({ ok: true, preview });
  });

  app.post(
    '/api/v1/memory/items',
    zValidator('json', memoryWriteSchema),
    async (context) => {
      try {
        const item = await options.store.upsert(toMemoryUpsertInput(context.req.valid('json')));
        options.afterMutation?.();
        return context.json({ ok: true, item }, 201);
      } catch (error: unknown) {
        return memoryErrorResponse(context, error);
      }
    }
  );

  app.put(
    '/api/v1/memory/items/:memoryId',
    zValidator('json', memoryWriteSchema),
    async (context) => {
      try {
        const item = await options.store.upsert({
          memoryId: context.req.param('memoryId'),
          ...toMemoryUpsertInput(context.req.valid('json'))
        });
        options.afterMutation?.();
        return context.json({ ok: true, item });
      } catch (error: unknown) {
        return memoryErrorResponse(context, error);
      }
    }
  );

  app.delete('/api/v1/memory/items/:memoryId', async (context) => {
    try {
      const removed = await options.store.remove(context.req.param('memoryId'));
      if (removed) {
        options.afterMutation?.();
      }
      return context.json({ ok: true, removed });
    } catch (error: unknown) {
      return memoryErrorResponse(context, error);
    }
  });

  return app;
}

function toMemoryUpsertInput(input: z.infer<typeof memoryWriteSchema>): MemoryUpsertInput {
  const metadata = sanitizeUserEditableMemoryMetadata(input.metadata);
  return {
    scope: input.scope,
    body: input.body,
    ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    ...(metadata === undefined ? {} : { metadata })
  };
}

function sanitizeUserEditableMemoryMetadata(
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (metadata === undefined) {
    return undefined;
  }
  const {
    builtin,
    source,
    agentId,
    ...editableMetadata
  } = metadata;
  void builtin;
  void source;
  void agentId;
  return Object.keys(editableMetadata).length === 0 ? undefined : editableMetadata;
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function memoryErrorResponse(context: {
  json: (value: { ok: false; code: string; message: string }, status: 400 | 500) => Response;
}, error: unknown): Response {
  if (error instanceof LinnsyError && isMemoryErrorCode(error.code)) {
    return context.json({
      ok: false,
      code: error.code,
      message: error.message
    }, 400);
  }

  const message = error instanceof Error ? error.message : 'unknown memory error';
  return context.json({
    ok: false,
    code: 'LINNSY_MEMORY_INTERNAL_ERROR',
    message
  }, 500);
}

function isMemoryErrorCode(code: string): boolean {
  return code === MEMORY_ERROR_CODES.ITEM_NOT_FOUND
    || code === MEMORY_ERROR_CODES.ITEM_INVALID;
}
