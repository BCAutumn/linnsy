import { z } from 'zod';

export const userModelProviderTypeSchema = z.enum(['openai_compatible', 'anthropic_compatible']);
export const modelApiProtocolSchema = z.string().min(1);

export const userModelPreferenceSchema = z.object({
  id: z.string(),
  providerType: userModelProviderTypeSchema,
  baseUrl: z.string(),
  modelName: z.string(),
  hasApiKey: z.boolean(),
  displayName: z.string().optional(),
  apiKeyEnv: z.string().optional()
}).strict();

export const userModelWriteInputSchema = z.object({
  id: z.string(),
  providerType: userModelProviderTypeSchema,
  baseUrl: z.string(),
  modelName: z.string(),
  apiKey: z.string().optional(),
  displayName: z.string().optional(),
  apiKeyEnv: z.string().optional()
}).strict();

export const modelSummarySchema = z.object({
  id: z.string(),
  provider: z.string(),
  apiProtocol: modelApiProtocolSchema,
  modelName: z.string(),
  displayName: z.string().optional(),
  baseUrl: z.string().optional(),
  source: z.literal('user'),
  hasApiKey: z.boolean()
}).strict();

export const modelSettingsSchema = z.object({
  chatModelId: z.string().nullable(),
  models: z.array(modelSummarySchema),
  userModels: z.array(userModelPreferenceSchema)
}).strict();

export const modelSettingsWriteRequestSchema = z.object({
  chatModelId: z.string().nullable(),
  userModels: z.array(userModelWriteInputSchema)
}).strict();

export const modelSettingsResponseSchema = z.object({
  ok: z.literal(true),
  settings: modelSettingsSchema
}).strict();

export type UserModelProviderType = z.infer<typeof userModelProviderTypeSchema>;
export type UserModelPreference = z.infer<typeof userModelPreferenceSchema>;
export type UserModelWriteInput = z.infer<typeof userModelWriteInputSchema>;
export type ModelSummary = z.infer<typeof modelSummarySchema>;
export type ModelSettings = z.infer<typeof modelSettingsSchema>;
