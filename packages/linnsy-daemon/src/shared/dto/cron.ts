import { z } from 'zod';

export const cronScheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('one_shot'), atMs: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal('daily'), time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/u) }).strict(),
  z.object({
    kind: z.literal('weekly'),
    dayOfWeek: z.number().int().min(0).max(6),
    time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/u)
  }).strict(),
  z.object({ kind: z.literal('interval'), intervalMs: z.number().int().positive() }).strict()
]);

export const cronListEntrySchema = z.object({
  jobId: z.string(),
  schedule: cronScheduleSchema,
  query: z.string(),
  nextRunAt: z.number(),
  enabled: z.boolean()
}).strict();

export const createCronRequestSchema = z.object({
  query: z.string().trim().min(1),
  definitionKey: z.string().trim().min(1).optional(),
  schedule: cronScheduleSchema
}).strict();

export const cronRunStatusSchema = z.enum(['skipped_grace', 'running', 'completed', 'failed']);

export const cronRunSummarySchema = z.object({
  cronRunId: z.string(),
  jobId: z.string(),
  scheduledAt: z.number(),
  startedAt: z.number().optional(),
  finishedAt: z.number().optional(),
  status: cronRunStatusSchema,
  runId: z.string().optional(),
  errorCode: z.string().optional()
}).strict();

export const cronRunOutputSchema = z.object({
  conversationId: z.string().nullable(),
  earliestMessageAt: z.number().nullable(),
  summaryText: z.string(),
  summaryLength: z.number(),
  hasSubagentSummary: z.boolean(),
  outboundMessageCount: z.number()
}).strict();

export const cronListResponseSchema = z.object({
  ok: z.literal(true),
  jobs: z.array(cronListEntrySchema)
}).strict();

export const cronJobResponseSchema = z.object({
  ok: z.literal(true),
  job: cronListEntrySchema
}).strict();

export const deleteCronResponseSchema = z.object({
  ok: z.literal(true),
  jobId: z.string(),
  deleted: z.boolean()
}).strict();

export const updateCronResponseSchema = z.object({
  ok: z.literal(true),
  jobId: z.string(),
  enabled: z.boolean(),
  updated: z.boolean()
}).strict();

export const cronRunsResponseSchema = z.object({
  ok: z.literal(true),
  jobId: z.string(),
  runs: z.array(cronRunSummarySchema)
}).strict();

export const cronRunOutputResponseSchema = z.object({
  ok: z.literal(true),
  jobId: z.string(),
  cronRunId: z.string(),
  run: cronRunSummarySchema,
  output: cronRunOutputSchema
}).strict();

export type CronSchedule = z.infer<typeof cronScheduleSchema>;
export type CronListEntry = z.infer<typeof cronListEntrySchema>;
export type CreateCronInput = z.infer<typeof createCronRequestSchema>;
export type CronRunStatus = z.infer<typeof cronRunStatusSchema>;
export type CronRunSummary = z.infer<typeof cronRunSummarySchema>;
export type CronRunOutput = z.infer<typeof cronRunOutputSchema>;
export type CronRunOutputResponse = Omit<z.infer<typeof cronRunOutputResponseSchema>, 'ok'>;
