import { z } from 'zod';

export const jsonRecordSchema = z.record(z.unknown());

export const okResponseSchema = z.object({
  ok: z.literal(true)
}).strict();

export const optionalCursorSchema = {
  nextCursor: z.string().optional()
} as const;
