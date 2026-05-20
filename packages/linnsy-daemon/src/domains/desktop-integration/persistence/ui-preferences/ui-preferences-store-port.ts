import type { ZodType } from 'zod';

export const UI_PREFERENCE_ERROR_CODES = {
  KEY_UNKNOWN: 'LINNSY_UI_PREFERENCE_KEY_UNKNOWN',
  VALUE_INVALID: 'LINNSY_UI_PREFERENCE_VALUE_INVALID'
} as const;

export interface UiPreferenceSchema<T = unknown> {
  key: string;
  zod: ZodType<T>;
  default: T;
}

export interface UiPreferencesStorePort {
  get(key: string): Promise<unknown>;
  getAll(): Promise<Record<string, unknown>>;
  set(key: string, value: unknown): Promise<void>;
  reset(key: string): Promise<void>;
  register<T>(schema: UiPreferenceSchema<T>): void;
}
