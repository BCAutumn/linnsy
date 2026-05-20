import { z } from 'zod';

export const channelLifecycleSchema = z.enum([
  'idle',
  'starting',
  'awaiting_login',
  'connected',
  'degraded'
]);

export const channelLoginHintSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('qr'),
    url: z.string().min(1),
    expiresAt: z.number().optional()
  }).strict(),
  z.object({
    kind: z.literal('token_required')
  }).strict()
]);

export const channelDesktopStatusSchema = z.object({
  channelId: z.string().min(1),
  lifecycle: channelLifecycleSchema,
  autoConnect: z.boolean(),
  loginHint: channelLoginHintSchema.optional(),
  detail: z.string().optional()
}).strict();

export const channelDesktopActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start') }).strict(),
  z.object({ type: z.literal('stop') }).strict(),
  z.object({ type: z.literal('reconnect-network') }).strict(),
  z.object({ type: z.literal('delete-account') }).strict(),
  z.object({ type: z.literal('request-qr-code') }).strict(),
  z.object({
    type: z.literal('set-auto-connect'),
    enabled: z.boolean()
  }).strict()
]);

export const channelDesktopStatusListSchema = z.array(channelDesktopStatusSchema);

export type ChannelLifecycle = z.infer<typeof channelLifecycleSchema>;
export type ChannelLoginHint = z.infer<typeof channelLoginHintSchema>;
export type ChannelDesktopStatus = z.infer<typeof channelDesktopStatusSchema>;
export type ChannelDesktopAction = z.infer<typeof channelDesktopActionSchema>;

export function isChannelDesktopAction(value: unknown): value is ChannelDesktopAction {
  return channelDesktopActionSchema.safeParse(value).success;
}

export function parseChannelDesktopStatus(value: unknown): ChannelDesktopStatus {
  return channelDesktopStatusSchema.parse(value);
}

export function parseChannelDesktopStatusList(value: unknown): ChannelDesktopStatus[] {
  return channelDesktopStatusListSchema.parse(value);
}

export function parseChannelDesktopAction(value: unknown): ChannelDesktopAction {
  return channelDesktopActionSchema.parse(value);
}
