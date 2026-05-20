import { z } from 'zod';

export const codexTaskSessionStatusSchema = z.enum([
  'received',
  'dispatched',
  'in_progress',
  'paused',
  'completed',
  'reported',
  'archived',
  'failed',
  'cancelled'
]);

export const codexTaskLocatorSchema = z.object({
  kind: z.enum(['directory', 'project', 'remote', 'none']),
  label: z.string(),
  ref: z.string().optional()
}).strict();

export const codexTaskSessionSnapshotSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  status: codexTaskSessionStatusSchema,
  locator: codexTaskLocatorSchema.optional(),
  workspacePath: z.string().optional(),
  sessionId: z.string().optional(),
  promptPreview: z.string().optional(),
  finalMessagePreview: z.string().optional(),
  canOpen: z.boolean()
}).strict();

export const codexTaskSessionResponseSchema = z.object({
  ok: z.literal(true),
  session: codexTaskSessionSnapshotSchema
}).strict();

export const codexThreadMetadataSchema = z.object({
  id: z.string(),
  updatedAt: z.number(),
  threadName: z.string().optional(),
  cwd: z.string().optional(),
  isChildOfRequestedCwd: z.boolean().optional(),
  source: z.string().optional(),
  originator: z.string().optional()
}).strict();

export const codexRecentThreadsResponseSchema = z.object({
  ok: z.literal(true),
  threads: z.array(codexThreadMetadataSchema)
}).strict();

export const codexThreadProjectSchema = z.object({
  cwd: z.string(),
  label: z.string(),
  threadCount: z.number(),
  latestUpdatedAt: z.number()
}).strict();

export const codexThreadProjectsResponseSchema = z.object({
  ok: z.literal(true),
  projects: z.array(codexThreadProjectSchema)
}).strict();

export type CodexTaskSessionSnapshot = z.infer<typeof codexTaskSessionSnapshotSchema>;
export type CodexTaskSessionResponse = z.infer<typeof codexTaskSessionResponseSchema>;
export type CodexThreadMetadata = z.infer<typeof codexThreadMetadataSchema>;
export type CodexRecentThreadsResponse = z.infer<typeof codexRecentThreadsResponseSchema>;
export type CodexThreadProject = z.infer<typeof codexThreadProjectSchema>;
export type CodexThreadProjectsResponse = z.infer<typeof codexThreadProjectsResponseSchema>;
