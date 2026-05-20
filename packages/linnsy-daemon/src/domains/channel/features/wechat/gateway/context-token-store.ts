import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { isRecord } from '../../../../../shared/json.js';

import type {
  ContextTokenRecord,
  ContextTokenStorePort,
  WechatGatewayStateStoreOptions
} from './types.js';

const CONTEXT_TOKENS_FILENAME = 'context-tokens.json';

export function createContextTokenStore(options: WechatGatewayStateStoreOptions): ContextTokenStorePort {
  const filePath = join(options.stateDir, CONTEXT_TOKENS_FILENAME);
  // Phase 1 assumes a single gateway process owns this state directory.
  // We only serialize operations inside the current process, not across processes.
  const runSerialized = createSerializedRunner();

  return {
    async save(input: ContextTokenRecord): Promise<void> {
      await runSerialized(async () => {
        const tokens = await readContextTokens(filePath);
        tokens[input.chatId] = input.token;
        await writeContextTokens(filePath, tokens);
      });
    },

    async get(chatId: string): Promise<ContextTokenRecord | null> {
      return runSerialized(async () => {
        const tokens = await readContextTokens(filePath);
        const token = tokens[chatId];
        if (token === undefined) {
          return null;
        }

        return {
          chatId,
          token
        };
      });
    },

    async clear(): Promise<void> {
      await runSerialized(async () => {
        await rm(filePath, { force: true });
      });
    }
  };
}

type StoredContextTokens = Record<string, string>;

async function readContextTokens(filePath: string): Promise<StoredContextTokens> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isStoredContextTokens(parsed)) {
      throw new Error(`invalid context token state at ${filePath}`);
    }
    return parsed;
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return {};
    }
    throw error;
  }
}

async function writeContextTokens(filePath: string, tokens: StoredContextTokens): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFile(filePath, `${JSON.stringify(tokens, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function isStoredContextTokens(value: unknown): value is StoredContextTokens {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === 'string');
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function createSerializedRunner(): <T>(operation: () => Promise<T>) => Promise<T> {
  let pending = Promise.resolve();

  return async function runSerialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(operation);
    pending = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };
}
