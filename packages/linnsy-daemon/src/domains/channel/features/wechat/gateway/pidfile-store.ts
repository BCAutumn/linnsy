import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { isRecord } from '../../../../../shared/json.js';

import type { WechatGatewayStateStoreOptions } from './types.js';

const PIDFILE_NAME = 'gateway.pid';
const BEARER_HASH_LENGTH = 12;

// pidfile 是给"上次没退干净"留的锚点：sidecar 启动时写 PID + bind + bearerHash，
// 退出（runner.stop / SIGTERM）时 unlink。Electron 启动时读这份文件，活的视作孤儿
// 报告日志，stale（PID 已不存在）就直接删掉。文件本身不携带任何敏感信息——
// bearerHash 是 sha256 前 12 个十六进制字符，只够识别"是不是同一个 token"，不能反推。
export interface WechatGatewayPidfile {
  pid: number;
  startedAt: number;
  bind: string;
  bearerHash: string;
}

export interface WechatGatewayPidfileStore {
  write(input: WechatGatewayPidfile): Promise<void>;
  read(): Promise<WechatGatewayPidfile | null>;
  clear(): Promise<void>;
  readonly path: string;
}

export function createWechatGatewayPidfileStore(
  options: WechatGatewayStateStoreOptions
): WechatGatewayPidfileStore {
  const filePath = join(options.stateDir, PIDFILE_NAME);

  return {
    path: filePath,

    async write(input: WechatGatewayPidfile): Promise<void> {
      await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
      // 写到 .tmp 再 rename，避免另一端在中间状态下读到半个文件。
      const tmpPath = `${filePath}.tmp`;
      await writeFile(tmpPath, `${JSON.stringify(input, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      });
      await rename(tmpPath, filePath);
    },

    async read(): Promise<WechatGatewayPidfile | null> {
      let raw: string;
      try {
        raw = await readFile(filePath, 'utf8');
      } catch (error: unknown) {
        if (isNotFoundError(error)) {
          return null;
        }
        throw error;
      }

      // JSON 损坏 / schema 不匹配的情况都视作 null，由 inspector 走 stale 路径清掉。
      // 不抛错是因为 pidfile 本身是不可信的运行时痕迹，损坏不应该让 sidecar 启动失败。
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        return null;
      }
      if (!isWechatGatewayPidfile(parsed)) {
        return null;
      }
      return parsed;
    },

    async clear(): Promise<void> {
      await rm(filePath, { force: true });
    }
  };
}

export function hashWechatGatewayBearer(bearer: string): string {
  return createHash('sha256').update(bearer).digest('hex').slice(0, BEARER_HASH_LENGTH);
}

function isWechatGatewayPidfile(value: unknown): value is WechatGatewayPidfile {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.pid === 'number'
    && Number.isInteger(value.pid)
    && value.pid > 0
    && typeof value.startedAt === 'number'
    && Number.isFinite(value.startedAt)
    && typeof value.bind === 'string'
    && value.bind.length > 0
    && typeof value.bearerHash === 'string'
    && value.bearerHash.length > 0;
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
