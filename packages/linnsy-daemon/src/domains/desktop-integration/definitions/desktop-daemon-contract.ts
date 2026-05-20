import { z } from 'zod';

export const daemonDesktopLifecycleSchema = z.enum([
  'starting',
  'running',
  'stopped',
  'failed'
]);

export const daemonDesktopStatusSchema = z.object({
  lifecycle: daemonDesktopLifecycleSchema,
  running: z.boolean(),
  detail: z.string().optional(),
  exitCode: z.number().optional(),
  signal: z.string().optional()
}).strict();

export type DaemonDesktopLifecycle = z.infer<typeof daemonDesktopLifecycleSchema>;
export type DaemonDesktopStatus = z.infer<typeof daemonDesktopStatusSchema>;

export function parseDaemonDesktopStatus(value: unknown): DaemonDesktopStatus {
  return daemonDesktopStatusSchema.parse(value);
}
