import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { isRecord } from '../../../../../shared/json.js';

import type {
  WechatAccountStorePort,
  WechatGatewayAccount,
  WechatGatewayStateStoreOptions
} from './types.js';

const ACCOUNT_FILENAME = 'account.json';

export function createWechatAccountStore(
  options: WechatGatewayStateStoreOptions
): WechatAccountStorePort {
  const filePath = join(options.stateDir, ACCOUNT_FILENAME);
  const runSerialized = createSerializedRunner();

  return {
    save(input: WechatGatewayAccount): Promise<void> {
      return runSerialized(async () => {
        await writeAccount(filePath, input);
      });
    },

    get(): Promise<WechatGatewayAccount | null> {
      return runSerialized(async () => {
        return readAccount(filePath);
      });
    },

    clear(): Promise<void> {
      return runSerialized(async () => {
        await rm(filePath, { force: true });
      });
    }
  };
}

async function readAccount(filePath: string): Promise<WechatGatewayAccount | null> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isWechatGatewayAccount(parsed)) {
      throw new Error(`invalid wechat account state at ${filePath}`);
    }
    return parsed;
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

async function writeAccount(filePath: string, account: WechatGatewayAccount): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFile(filePath, `${JSON.stringify(account, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
}

function isWechatGatewayAccount(value: unknown): value is WechatGatewayAccount {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.accountId === 'string'
    && typeof value.botToken === 'string'
    && typeof value.baseUrl === 'string'
    && typeof value.connectedAt === 'number'
    && (value.userId === undefined || typeof value.userId === 'string');
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
