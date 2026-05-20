import { z } from 'zod';

export const themePrimaryColorSchema = z.enum([
  'distant_sky',
  'pine_cypress',
  'jade_mist',
  'ink_cyan',
  'moon_white',
  'royal_blue',
  'bamboo_ash',
  'lilac',
  'dai_purple',
  'autumn_fragrance',
  'amber_yellow',
  'tea_brown',
  'willow_green',
  'rouge',
  'rosy_red'
]);

export const uiPreferencesSchema = z.object({
  'theme.mode': z.enum(['auto', 'light', 'dark']),
  'theme.primary_color': themePrimaryColorSchema,
  'font.size': z.enum(['small', 'medium', 'large']),
  'sidebar.width_px': z.number().int().min(200).max(360),
  'sidebar.archived_collapsed': z.boolean(),
  last_opened_conversation_id: z.string().nullable(),
  language: z.enum(['zh-CN', 'en-US']),
  'scheduled.skip_inactive_delete_confirm': z.boolean()
}).strict();

export const uiPreferencesResponseSchema = z.object({
  ok: z.literal(true),
  preferences: uiPreferencesSchema
}).strict();

export type ThemePrimaryColor = z.infer<typeof themePrimaryColorSchema>;
export type UiPreferences = z.infer<typeof uiPreferencesSchema>;
