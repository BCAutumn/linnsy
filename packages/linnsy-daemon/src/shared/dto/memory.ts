import { z } from 'zod';

import { jsonRecordSchema } from './common.js';

export const memoryItemSchema = z.object({
  memoryId: z.string(),
  scope: z.string(),
  body: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  archivedAt: z.number().optional(),
  conversationId: z.string().optional(),
  expiresAt: z.number().optional(),
  metadata: jsonRecordSchema.optional()
}).strict();

export const memoryItemWriteInputSchema = z.object({
  scope: z.string().min(1),
  body: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  expiresAt: z.number().int().positive().optional(),
  metadata: jsonRecordSchema.optional()
}).strict();

export const systemPromptPreviewSectionSchema = z.object({
  scope: z.enum(['system_prompt', 'persona', 'work_style', 'user_preference', 'long_term_memory']),
  heading: z.string(),
  body: z.string(),
  editable: z.boolean()
}).strict();

export const systemPromptPreviewSchema = z.object({
  agentId: z.string(),
  role: z.literal('system'),
  shapingVersion: z.string(),
  assembledPrompt: z.string(),
  sections: z.array(systemPromptPreviewSectionSchema)
}).strict();

export const listMemoryItemsResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(memoryItemSchema)
}).strict();

export const memoryItemResponseSchema = z.object({
  ok: z.literal(true),
  item: memoryItemSchema
}).strict();

export const deleteMemoryItemResponseSchema = z.object({
  ok: z.literal(true),
  removed: z.boolean()
}).strict();

export const systemPromptPreviewResponseSchema = z.object({
  ok: z.literal(true),
  preview: systemPromptPreviewSchema
}).strict();

export interface ListMemoryItemsOptions {
  query?: string;
  scope?: string;
  limit?: number;
}

export type MemoryItem = z.infer<typeof memoryItemSchema>;
export type MemoryItemWriteInput = z.infer<typeof memoryItemWriteInputSchema>;
export type SystemPromptPreviewSection = z.infer<typeof systemPromptPreviewSectionSchema>;
export type SystemPromptPreview = z.infer<typeof systemPromptPreviewSchema>;
