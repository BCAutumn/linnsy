import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { sanitizeUiHint, type UiHint } from '../src/domains/desktop-integration/definitions/ui-hint-contract.js';

export interface UiHintStore {
  /** 文件不存在 / 损坏 / sanitize 不通过 → 返回 null（让 renderer 走 default）。 */
  read(): Promise<UiHint | null>;
  write(hint: UiHint): Promise<void>;
  /** preload additionalArguments 透传用，main 启动时一次性读取。 */
  filePath: string;
}

export interface CreateUiHintStoreOptions {
  userDataDir: string;
  /** 注入测试用，默认 fs。 */
  fs?: UiHintStorageFs;
}

export interface UiHintStorageFs {
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  ensureDir(path: string): Promise<void>;
}

const STORAGE_FILENAME = 'last-ui-hint.json';

// 桌面壳"上次 UI 提示"的本机持久化器。
// 唯一目的：让下次启动 preload 在 renderer 第一行 JS 之前同步读到 hint，
// 把 <html data-mode> 与 AppShell 初始 state 一次性落上去，从根上消除
// "先白屏 → 切深色"的开屏闪烁。
//
// 设计约束（详见 docs/04 §6.5）：
//   - daemon 始终是 ui_preferences 的真实源头；hint 只是启动期视觉提示，
//     daemon 拉到真值后立即覆盖，hint 与真值不一致 → 一律以 daemon 为准。
//   - renderer 不写 localStorage / IndexedDB / cookie（§6.2 红线），所以
//     持久化必须由 main 接管，preload 通过 additionalArguments 同步注入。
//   - 损坏文件不抛：sanitize 不通过 → 当作没有 hint，daemon 真值会覆盖。
//   - 写失败也不抛：丢一次 hint 等价于"用户上次没改主题"，不影响功能。
export function createUiHintStore(options: CreateUiHintStoreOptions): UiHintStore {
  const fs = options.fs ?? defaultFs;
  const filePath = join(options.userDataDir, STORAGE_FILENAME);

  return {
    filePath,
    async read() {
      let raw: string;
      try {
        raw = await fs.readFile(filePath);
      } catch (error: unknown) {
        if (isNotFound(error)) {
          return null;
        }
        // 读失败但不是 ENOENT（权限 / IO 错误）→ 当作没有 hint，让 default
        // 兜底；不抛是为了不让 main bootstrap 因为这种边角问题挂掉。
        return null;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return null;
      }
      return sanitizeUiHint(parsed);
    },
    async write(hint) {
      await fs.ensureDir(dirname(filePath));
      await fs.writeFile(filePath, `${JSON.stringify(hint, null, 2)}\n`);
    }
  };
}

const defaultFs: UiHintStorageFs = {
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
