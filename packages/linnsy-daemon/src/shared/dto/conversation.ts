import { z } from 'zod';

import { jsonRecordSchema, optionalCursorSchema } from './common.js';
import { runtimeEventEnvelopeSchema } from './runtime-event.js';

export const conversationSummarySchema = z.object({
  conversationId: z.string(),
  sessionKey: z.string().optional(),
  platform: z.string(),
  chatType: z.string(),
  chatId: z.string(),
  userId: z.string().optional(),
  title: z.string().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number(),
  lastActivityAt: z.number(),
  pinnedAt: z.number().optional(),
  archivedAt: z.number().optional()
}).strict();

export const terminalBindingSnapshotSchema = z.object({
  terminalId: z.string(),
  conversationId: z.string(),
  updatedAt: z.number(),
  updatedBy: z.string()
}).strict();

export const conversationMessageSchema = z.object({
  messageId: z.string(),
  conversationId: z.string().optional(),
  role: z.string(),
  source: z.string(),
  platform: z.string().optional(),
  text: z.string().optional(),
  replyToId: z.string().optional(),
  runId: z.string().optional(),
  metadata: jsonRecordSchema.optional(),
  streaming: z.boolean().optional(),
  createdAt: z.number()
}).strict();

export const patchConversationRequestSchema = z.object({
  title: z.string().nullable().optional(),
  pinned: z.boolean().optional()
}).strict();

export const updateTerminalBindingRequestSchema = z.object({
  conversationId: z.string().min(1)
}).strict();

export const listConversationsResponseSchema = z.object({
  conversations: z.array(conversationSummarySchema)
}).strict();

export const createdConversationResponseSchema = z.object({
  ok: z.literal(true),
  conversation: conversationSummarySchema
}).strict();

export const conversationResponseSchema = createdConversationResponseSchema;

export const deleteConversationResponseSchema = z.object({
  ok: z.literal(true),
  deleted: z.boolean(),
  conversationId: z.string().optional()
}).strict();

export const terminalBindingResponseSchema = z.object({
  ok: z.literal(true),
  binding: terminalBindingSnapshotSchema
}).strict();

export const messagesResponseSchema = z.object({
  messages: z.array(conversationMessageSchema),
  ...optionalCursorSchema
}).strict();

export const conversationEventsResponseSchema = z.object({
  events: z.array(runtimeEventEnvelopeSchema),
  ...optionalCursorSchema
}).strict();

export type ConversationSummary = z.infer<typeof conversationSummarySchema>;
export type TerminalBindingSnapshot = z.infer<typeof terminalBindingSnapshotSchema>;
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export type PatchConversationRequest = z.infer<typeof patchConversationRequestSchema>;
export type UpdateTerminalBindingRequest = z.infer<typeof updateTerminalBindingRequestSchema>;
