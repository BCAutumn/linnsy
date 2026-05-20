import type { App } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface DesktopPreferences {
  channelAutoConnect: Record<string, boolean>;
}

export interface DesktopPreferencesStore {
  get(): Promise<DesktopPreferences>;
  set(input: Partial<DesktopPreferences>): Promise<DesktopPreferences>;
}

const defaults: DesktopPreferences = {
  channelAutoConnect: {}
};

export function createDesktopPreferencesStore(app: App): DesktopPreferencesStore {
  const filePath = join(app.getPath('userData'), 'desktop-preferences.json');

  return {
    async get(): Promise<DesktopPreferences> {
      try {
        const raw = await readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        const normalized = normalizePreferences(parsed);
        if (shouldPersistNormalizedPreferences(parsed, normalized)) {
          await writePreferences(filePath, normalized);
        }
        return normalized;
      } catch (error: unknown) {
        if (isNodeError(error) && error.code === 'ENOENT') {
          return defaults;
        }
        throw error;
      }
    },

    async set(input): Promise<DesktopPreferences> {
      const current = await this.get();
      const next = {
        ...current,
        ...input,
        channelAutoConnect: {
          ...current.channelAutoConnect,
          ...input.channelAutoConnect
        }
      };
      await writePreferences(filePath, next);
      return next;
    }
  };
}

export function isChannelAutoConnectEnabled(preferences: DesktopPreferences, channelId: string): boolean {
  return preferences.channelAutoConnect[channelId] === true;
}

export function setChannelAutoConnectPreference(
  preferences: DesktopPreferences,
  channelId: string,
  enabled: boolean
): DesktopPreferences {
  return {
    channelAutoConnect: {
      ...preferences.channelAutoConnect,
      [channelId]: enabled
    }
  };
}

function normalizePreferences(input: unknown): DesktopPreferences {
  if (!isRecord(input)) {
    return defaults;
  }

  const migratedWechatAutoConnect = input.wechatAutoConnect === true;
  const channelAutoConnect = isBooleanRecord(input.channelAutoConnect)
    ? input.channelAutoConnect
    : {};

  return {
    channelAutoConnect: {
      ...channelAutoConnect,
      ...(input.wechatAutoConnect === undefined ? {} : { wechat: migratedWechatAutoConnect })
    }
  };
}

function shouldPersistNormalizedPreferences(input: unknown, normalized: DesktopPreferences): boolean {
  return isRecord(input) && (
    input.wechatAutoConnect !== undefined
    || !isBooleanRecord(input.channelAutoConnect)
    || JSON.stringify(input.channelAutoConnect) !== JSON.stringify(normalized.channelAutoConnect)
  );
}

async function writePreferences(filePath: string, preferences: DesktopPreferences): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(preferences, null, 2)}\n`, 'utf8');
}

function isBooleanRecord(value: unknown): value is Record<string, boolean> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'boolean');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
