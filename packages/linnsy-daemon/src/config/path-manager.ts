import { mkdir } from 'node:fs/promises';
import { join, win32 } from 'node:path';

// 这里有意使用带空格的大写目录名，优先照顾安装包用户在 Finder / Explorer 里的可读性。
// 若未来出现真实工具在含空格 cwd 下频繁翻车，再评估改成 linnsy-work 或提供系统快捷方式。
export const DEFAULT_LINNSY_WORK_DIR_NAME = 'Linnsy Work';

export interface ResolveLinnsyPathOptions {
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  cwd?: string;
}

export interface CreateLinnsyPathManagerOptions extends ResolveLinnsyPathOptions {
  linnsyHome?: string;
  taskWorkspaceRoot?: string;
  linnsyWorkRoot?: string;
  clock?: {
    now(): number;
  };
}

export interface DefaultUserWorkDirectoryInput {
  title: string;
  prompt?: string;
}

export interface DefaultUserWorkDirectory {
  root: string;
  directory: string;
  slug: string;
  label: string;
}

export interface LinnsyPathManager {
  readonly userHome: string;
  readonly linnsyHome: string;
  readonly auditRoot: string;
  readonly taskWorkspaceRoot: string;
  readonly auditLogPath: string;
  readonly runContextAuditLogPath: string;
  readonly linnsyWorkRoot: string;
  createDefaultUserWorkDirectory(input: DefaultUserWorkDirectoryInput): Promise<DefaultUserWorkDirectory>;
}

const whitespacePattern = /\s+/gu;
const repeatedDashPattern = /-+/gu;
const edgeDashPattern = /^-|-$/gu;
const invalidPathChars = new Set(['/', '\\', ':', '*', '?', '"', '<', '>', '|']);
const maxSlugPrefixLength = 30;
const maxDirectoryAttempts = 100;

export function createLinnsyPathManager(options: CreateLinnsyPathManagerOptions = {}): LinnsyPathManager {
  const userHome = resolveUserHome(options);
  const linnsyHome = options.linnsyHome ?? resolveDefaultLinnsyHome(options);
  const auditRoot = resolveDefaultAuditRoot(linnsyHome);
  const taskWorkspaceRoot = options.taskWorkspaceRoot ?? resolveDefaultTaskWorkspaceRoot(linnsyHome);
  const auditLogPath = resolveDefaultAuditLogPath(linnsyHome);
  const runContextAuditLogPath = resolveDefaultRunContextAuditLogPath(linnsyHome);
  const linnsyWorkRoot = options.linnsyWorkRoot ?? resolveDefaultLinnsyWorkRoot({ ...options, userHome });
  const clock = options.clock ?? { now: () => Date.now() };

  return {
    userHome,
    linnsyHome,
    auditRoot,
    taskWorkspaceRoot,
    auditLogPath,
    runContextAuditLogPath,
    linnsyWorkRoot,
    async createDefaultUserWorkDirectory(input): Promise<DefaultUserWorkDirectory> {
      const dateStamp = formatLocalDate(new Date(clock.now()));
      const slugPrefix = createSlugPrefix([input.title, input.prompt]);
      const baseSlug = `${slugPrefix}-${dateStamp}`;
      await mkdir(linnsyWorkRoot, { recursive: true, mode: 0o700 });

      for (let index = 0; index < maxDirectoryAttempts; index += 1) {
        const slug = index === 0 ? baseSlug : `${baseSlug}-${String(index + 1)}`;
        const directory = join(linnsyWorkRoot, slug);
        try {
          await mkdir(directory, { recursive: false, mode: 0o700 });
          return {
            root: linnsyWorkRoot,
            directory,
            slug,
            label: slug
          };
        } catch (error: unknown) {
          if (isFileExistsError(error)) {
            continue;
          }
          throw error;
        }
      }

      throw new Error(`failed to allocate Linnsy Work directory for ${baseSlug}`);
    }
  };
}

export function resolveDefaultLinnsyHome(options: ResolveLinnsyPathOptions = {}): string {
  const env = options.env ?? process.env;
  if (env.LINNSY_HOME !== undefined && env.LINNSY_HOME.length > 0) {
    return env.LINNSY_HOME;
  }
  return getOsStandardLinnsyHome(options);
}

export function getOsStandardLinnsyHome(options: ResolveLinnsyPathOptions = {}): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = resolveUserHome(options);

  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Linnsy');
  }

  if (platform === 'win32') {
    const appData = env.APPDATA ?? win32.join(home, 'AppData', 'Roaming');
    return win32.join(appData, 'Linnsy');
  }

  const dataHome = env.XDG_DATA_HOME ?? join(home, '.local', 'share');
  return join(dataHome, 'Linnsy');
}

export function getLegacyLinnsyHome(options: ResolveLinnsyPathOptions = {}): string {
  return join(resolveUserHome(options), '.linnsy');
}

export function resolveDefaultTaskWorkspaceRoot(linnsyHome: string): string {
  return join(linnsyHome, 'workspaces');
}

export function resolveDefaultAuditRoot(linnsyHome: string): string {
  return join(linnsyHome, 'audit');
}

export function resolveDefaultAuditLogPath(linnsyHome: string): string {
  return join(resolveDefaultAuditRoot(linnsyHome), 'decisions.jsonl');
}

export function resolveDefaultRunContextAuditLogPath(linnsyHome: string): string {
  return join(resolveDefaultAuditRoot(linnsyHome), 'run-context.jsonl');
}

export function resolveDefaultLinnsyWorkRoot(options: ResolveLinnsyPathOptions & {
  userHome?: string;
} = {}): string {
  const platform = options.platform ?? process.platform;
  const userHome = options.userHome ?? resolveUserHome(options);
  if (platform === 'win32') {
    return win32.join(userHome, DEFAULT_LINNSY_WORK_DIR_NAME);
  }
  return join(userHome, DEFAULT_LINNSY_WORK_DIR_NAME);
}

export function resolveUserHome(options: ResolveLinnsyPathOptions = {}): string {
  const env = options.env ?? process.env;
  return env.HOME ?? env.USERPROFILE ?? options.cwd ?? process.cwd();
}

function createSlugPrefix(values: Array<string | undefined>): string {
  const raw = values
    .filter((value): value is string => value !== undefined && value.trim().length > 0)
    .join('-');
  const cleaned = Array.from(removeInvalidPathChars(raw.normalize('NFKC'))
    .replace(whitespacePattern, '-')
    .replace(repeatedDashPattern, '-')
    .replace(edgeDashPattern, ''))
    .slice(0, maxSlugPrefixLength)
    .join('')
    .replace(edgeDashPattern, '');

  return cleaned.length > 0 ? cleaned : 'linnsy-task';
}

function removeInvalidPathChars(value: string): string {
  return Array.from(value)
    .filter((char) => {
      const codePoint = char.codePointAt(0);
      return codePoint !== undefined && codePoint >= 32 && !invalidPathChars.has(char);
    })
    .join('');
}

function formatLocalDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function isFileExistsError(error: unknown): boolean {
  return isObjectWithCode(error) && error.code === 'EEXIST';
}

function isObjectWithCode(value: unknown): value is { code: unknown } {
  return typeof value === 'object' && value !== null && 'code' in value;
}
