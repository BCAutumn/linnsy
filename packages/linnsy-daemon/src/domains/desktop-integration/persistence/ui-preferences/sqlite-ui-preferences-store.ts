import type Database from 'better-sqlite3';
import { z } from 'zod';

import { LinnsyError } from '../../../../shared/errors.js';
import {
  UI_PREFERENCE_ERROR_CODES,
  type UiPreferenceSchema,
  type UiPreferencesStorePort
} from './ui-preferences-store-port.js';

const SIDEBAR_WIDTH_MIN = 200;
const SIDEBAR_WIDTH_MAX = 360;

interface UiPreferenceRow {
  value: string;
}

interface SqliteUiPreferencesStoreOptions {
  now?: () => number;
}

export class SqliteUiPreferencesStore implements UiPreferencesStorePort {
  private readonly schemas = new Map<string, UiPreferenceSchema>();
  private readonly getStatement: Database.Statement<[string], UiPreferenceRow>;
  private readonly upsertStatement: Database.Statement<[string, string, number]>;
  private readonly deleteStatement: Database.Statement<[string]>;
  private readonly now: () => number;

  public constructor(private readonly db: Database.Database, options: SqliteUiPreferencesStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.getStatement = db.prepare<[string], UiPreferenceRow>(
      `SELECT value
         FROM ui_preferences
       WHERE key = ?`
    );
    this.upsertStatement = db.prepare(
      `INSERT INTO ui_preferences (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`
    );
    this.deleteStatement = db.prepare(
      `DELETE FROM ui_preferences
       WHERE key = ?`
    );
  }

  public register<T>(schema: UiPreferenceSchema<T>): void {
    this.schemas.set(schema.key, schema);
  }

  public get(key: string): Promise<unknown> {
    try {
      return Promise.resolve(this.getSync(key));
    } catch (error: unknown) {
      return rejectError(error);
    }
  }

  public getSync(key: string): unknown {
    const schema = this.requireSchema(key);
    const row = this.getStatement.get(key);
    if (row === undefined) {
      return schema.default;
    }
    return this.parseStoredValue(key, row.value, schema);
  }

  public getAll(): Promise<Record<string, unknown>> {
    try {
      const values: Record<string, unknown> = {};
      for (const key of this.schemas.keys()) {
        const schema = this.requireSchema(key);
        const row = this.getStatement.get(key);
        values[key] = row === undefined ? schema.default : this.parseStoredValue(key, row.value, schema);
      }
      return Promise.resolve(values);
    } catch (error: unknown) {
      return rejectError(error);
    }
  }

  public set(key: string, value: unknown): Promise<void> {
    try {
      const schema = this.requireSchema(key);
      const parsed = this.parseInputValue(key, value, schema);
      this.upsertStatement.run(key, JSON.stringify(parsed), this.now());
      return Promise.resolve();
    } catch (error: unknown) {
      return rejectError(error);
    }
  }

  public reset(key: string): Promise<void> {
    try {
      this.requireSchema(key);
      this.deleteStatement.run(key);
      return Promise.resolve();
    } catch (error: unknown) {
      return rejectError(error);
    }
  }

  private requireSchema(key: string): UiPreferenceSchema {
    const schema = this.schemas.get(key);
    if (schema === undefined) {
      throw new LinnsyError(
        UI_PREFERENCE_ERROR_CODES.KEY_UNKNOWN,
        `unknown UI preference key ${key}`,
        false
      );
    }
    return schema;
  }

  private parseStoredValue(key: string, rawValue: string, schema: UiPreferenceSchema): unknown {
    try {
      const value = JSON.parse(rawValue) as unknown;
      return this.parseInputValue(key, value, schema);
    } catch (error: unknown) {
      if (error instanceof LinnsyError) {
        throw error;
      }
      throw invalidValueError(key, error);
    }
  }

  private parseInputValue(key: string, value: unknown, schema: UiPreferenceSchema): unknown {
    const result = schema.zod.safeParse(value);
    if (!result.success) {
      throw invalidValueError(key, result.error);
    }
    return result.data;
  }
}

export function createDefaultUiPreferencesStore(
  db: Database.Database,
  options: SqliteUiPreferencesStoreOptions = {}
): SqliteUiPreferencesStore {
  const store = new SqliteUiPreferencesStore(db, options);
  for (const schema of createDefaultUiPreferenceSchemas()) {
    store.register(schema);
  }
  return store;
}

export function createDefaultUiPreferenceSchemas(): UiPreferenceSchema[] {
  const themePrimaryColorSchema = z.enum([
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
    'rosy_red',
    'gray',
    'beige',
    'sea',
    'forest',
    'orange',
    'purple'
  ]).transform((value) => legacyThemePrimaryColorMap[value] ?? value);

  return [
    {
      key: 'theme.mode',
      zod: z.enum(['auto', 'light', 'dark']),
      default: 'auto'
    },
    {
      key: 'theme.primary_color',
      zod: themePrimaryColorSchema,
      default: 'distant_sky'
    },
    {
      key: 'font.size',
      zod: z.enum(['small', 'medium', 'large']),
      default: 'medium'
    },
    {
      key: 'sidebar.width_px',
      zod: z.number().int().transform((value) => clamp(value, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX)),
      default: 260
    },
    {
      key: 'sidebar.archived_collapsed',
      zod: z.boolean(),
      default: true
    },
    {
      key: 'last_opened_conversation_id',
      zod: z.string().min(1).nullable(),
      default: null
    },
    {
      key: 'language',
      zod: z.enum(['zh-CN', 'en-US']),
      default: 'zh-CN'
    },
    // 2026-05-05 拍板：定时安排"已停用 / 已完成 / 未送达"段的 reminder 删除时
    // 默认仍弹确认框，用户可在确认框里勾"不再提醒"以后续直接删；active 段的
    // 周期 cron 始终强制确认（破坏性更大），不受此偏好影响。
    {
      key: 'scheduled.skip_inactive_delete_confirm',
      zod: z.boolean(),
      default: false
    },
  ];
}

const legacyThemePrimaryColorMap: Record<string, string | undefined> = {
  gray: 'distant_sky',
  beige: 'amber_yellow',
  sea: 'jade_mist',
  forest: 'pine_cypress',
  orange: 'autumn_fragrance',
  purple: 'lilac'
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function invalidValueError(key: string, cause: unknown): LinnsyError {
  const message = cause instanceof Error
    ? `invalid UI preference value for ${key}: ${cause.message}`
    : `invalid UI preference value for ${key}`;
  return new LinnsyError(UI_PREFERENCE_ERROR_CODES.VALUE_INVALID, message, false);
}

function rejectError(error: unknown): Promise<never> {
  if (error instanceof Error) {
    return Promise.reject(error);
  }
  return Promise.reject(new Error('unknown sqlite ui preferences store error'));
}
