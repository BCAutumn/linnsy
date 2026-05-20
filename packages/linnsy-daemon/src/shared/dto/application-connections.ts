import { z } from 'zod';

export const codexConnectionStatusSchema = z.enum(['not_found', 'available', 'failed']);

export const codexConnectionStateSchema = z.object({
  status: codexConnectionStatusSchema,
  command: z.string(),
  checkedAt: z.number(),
  version: z.string().optional(),
  errorMessage: z.string().optional()
}).strict();

export const unsupportedApplicationConnectionStateSchema = z.object({
  status: z.literal('unsupported')
}).strict();

export const applicationConnectionsSnapshotSchema = z.object({
  codex: codexConnectionStateSchema,
  claudeCode: unsupportedApplicationConnectionStateSchema,
  cursor: unsupportedApplicationConnectionStateSchema
}).strict();

export const applicationConnectionsResponseSchema = z.object({
  ok: z.literal(true),
  connections: applicationConnectionsSnapshotSchema
}).strict();

export const codexConnectionProbeResponseSchema = z.object({
  ok: z.literal(true),
  codex: codexConnectionStateSchema
}).strict();

export type CodexConnectionStatus = z.infer<typeof codexConnectionStatusSchema>;
export type CodexConnectionState = z.infer<typeof codexConnectionStateSchema>;
export type UnsupportedApplicationConnectionState = z.infer<typeof unsupportedApplicationConnectionStateSchema>;
export type ApplicationConnectionsSnapshot = z.infer<typeof applicationConnectionsSnapshotSchema>;
