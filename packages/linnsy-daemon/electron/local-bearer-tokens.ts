import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface LocalBearerSpec {
  /** 子进程中读取该 token 的环境变量名，例如 LINNSY_WECHAT_GATEWAY_BEARER。 */
  envName: string;
  /** 持久化文件中作为 key 的稳定标识，例如 'wechat-gateway'。 */
  storageKey: string;
}

/** envName → token 值。main 直接展开到 spawner.env / apiConfig / statusClient。 */
export type LocalBearerTokens = Record<string, string>;

export interface ResolveLocalBearerTokensOptions {
  /** Electron app.getPath('userData') 或 dev 等价的目录。 */
  userDataDir: string;
  specs: LocalBearerSpec[];
  env?: NodeJS.ProcessEnv;
  /** 注入测试用，默认 32 字节随机 hex。 */
  generate?: () => string;
  /** 注入测试用，默认 fs。 */
  fs?: BearerStorageFs;
}

export interface BearerStorageFs {
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  ensureDir(path: string): Promise<void>;
}

const STORAGE_FILENAME = 'local-bearer-tokens.json';
const TOKEN_BYTE_LENGTH = 32;

// 集中负责"本机进程间通信 bearer"的解析与生成。每个 spec 按以下优先级落值：
//   1. process.env[spec.envName]：开发者可显式覆盖（任何回归调试场景）
//   2. {userDataDir}/local-bearer-tokens.json[spec.storageKey]：跨次启动稳定
//   3. crypto.randomBytes(32) 生成新 token，并写回上面的文件
// 持久化文件 mode 0o600（仅当前用户可读），避免同机其他用户嗅探本机 token。
//
// 设计意图（详见 docs/04 §6.4）：
//   - 桌面壳必须保证"开关一开 channel 就能用"。如果让用户自己 export
//     一堆 LINNSY_*_BEARER，就不是"一个永远在线的秘书"应有的开箱体验。
//   - 同时所有 token 必须只在本机生效；gateway 都绑 loopback，不外泄网络。
//   - 多个 channel 共用同一段解析逻辑，新加平台不再复制粘贴 fallback；
//     违反这一点的人会再写一份 'dev-secret' 硬编码出来——历史教训。
export async function resolveLocalBearerTokens(
  options: ResolveLocalBearerTokensOptions
): Promise<LocalBearerTokens> {
  const env = options.env ?? process.env;
  const generate = options.generate ?? defaultGenerate;
  const fs = options.fs ?? defaultFs;
  const filePath = join(options.userDataDir, STORAGE_FILENAME);
  const persisted = await readPersisted(fs, filePath);
  const result: LocalBearerTokens = {};
  let dirty = false;

  for (const spec of options.specs) {
    const fromEnv = env[spec.envName];
    if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
      result[spec.envName] = fromEnv;
      continue;
    }
    const fromFile = persisted[spec.storageKey];
    if (typeof fromFile === 'string' && fromFile.length > 0) {
      result[spec.envName] = fromFile;
      continue;
    }
    const generated = generate();
    persisted[spec.storageKey] = generated;
    result[spec.envName] = generated;
    dirty = true;
  }

  if (dirty) {
    await writePersisted(fs, filePath, persisted);
  }

  return result;
}

async function readPersisted(
  fs: BearerStorageFs,
  filePath: string
): Promise<Record<string, string>> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath);
  } catch (error: unknown) {
    if (isNotFound(error)) {
      return {};
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isStringRecord(parsed)) {
    return {};
  }
  return { ...parsed };
}

async function writePersisted(
  fs: BearerStorageFs,
  filePath: string,
  payload: Record<string, string>
): Promise<void> {
  await fs.ensureDir(dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function defaultGenerate(): string {
  return randomBytes(TOKEN_BYTE_LENGTH).toString('hex');
}

const defaultFs: BearerStorageFs = {
  async readFile(path) {
    return readFile(path, 'utf8');
  },
  async writeFile(path, data) {
    await writeFile(path, data, { mode: 0o600 });
  },
  async ensureDir(path) {
    await mkdir(path, { recursive: true, mode: 0o700 });
  }
};

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  for (const entry of Object.values(value as Record<string, unknown>)) {
    if (typeof entry !== 'string') {
      return false;
    }
  }
  return true;
}
