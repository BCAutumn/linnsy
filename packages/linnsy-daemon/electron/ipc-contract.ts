import { z } from 'zod';

export const DESKTOP_IPC_CHANNELS = {
  getApiConfig: 'linnsy:get-api-config',
  windowShow: 'linnsy:window-show',
  windowHide: 'linnsy:window-hide',
  autostartGet: 'linnsy:autostart-get',
  autostartSet: 'linnsy:autostart-set',
  daemonStatus: 'linnsy:daemon-status',
  daemonStatusChanged: 'linnsy:daemon:status-changed',
  channelsList: 'linnsy:channels:list',
  channelsGet: 'linnsy:channels:get',
  channelsInvoke: 'linnsy:channels:invoke',
  channelsStatusChanged: 'linnsy:channels:status-changed',
  codexSessionOpen: 'linnsy:codex-session:open',
  appQuit: 'linnsy:app-quit',
  persistUiHint: 'linnsy:persist-ui-hint'
} as const;

export const desktopApiConfigSchema = z.object({
  baseUrl: z.string().min(1),
  bearerToken: z.string().min(1)
}).strict();

export const codexSessionOpenInputSchema = z.object({
  sessionId: z.string().min(1),
  cwd: z.string().min(1).optional()
}).strict();

export const codexSessionOpenResultSchema = z.object({
  ok: z.literal(true),
  mode: z.literal('terminal')
}).strict();

export const autostartGetResultSchema = z.object({
  enabled: z.boolean()
}).strict();

export const autostartSetResultSchema = z.object({
  ok: z.literal(true),
  enabled: z.boolean()
}).strict();

export const okTrueResultSchema = z.object({
  ok: z.literal(true)
}).strict();

export const persistUiHintResultSchema = z.object({
  ok: z.boolean()
}).strict();

export type DesktopApiConfig = z.infer<typeof desktopApiConfigSchema>;
export type CodexSessionOpenInput = z.infer<typeof codexSessionOpenInputSchema>;
export type CodexSessionOpenResult = z.infer<typeof codexSessionOpenResultSchema>;
export type AutostartGetResult = z.infer<typeof autostartGetResultSchema>;
export type AutostartSetResult = z.infer<typeof autostartSetResultSchema>;
export type OkTrueResult = z.infer<typeof okTrueResultSchema>;
export type PersistUiHintResult = z.infer<typeof persistUiHintResultSchema>;

export function parseDesktopApiConfig(value: unknown): DesktopApiConfig {
  return desktopApiConfigSchema.parse(value);
}

export function parseCodexSessionOpenInput(value: unknown): CodexSessionOpenInput {
  return codexSessionOpenInputSchema.parse(value);
}

export function parseCodexSessionOpenResult(value: unknown): CodexSessionOpenResult {
  return codexSessionOpenResultSchema.parse(value);
}

export function parseAutostartGetResult(value: unknown): AutostartGetResult {
  return autostartGetResultSchema.parse(value);
}

export function parseAutostartSetResult(value: unknown): AutostartSetResult {
  return autostartSetResultSchema.parse(value);
}

export function parseOkTrueResult(value: unknown): OkTrueResult {
  return okTrueResultSchema.parse(value);
}

export function parsePersistUiHintResult(value: unknown): PersistUiHintResult {
  return persistUiHintResultSchema.parse(value);
}
