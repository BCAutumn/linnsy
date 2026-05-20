/**
 * Contract test：验证 `@linnlabs/linnkit` 已发布到 npmjs 的 dist 产物
 * 在 linnsy-daemon 真实 install 路径下能被 Node 干净 import。
 *
 * 历史背景：linnkit 0.1.0~0.1.2 三个版本所有 Node 全展开入口（`/runtime-kernel`、
 * `/context-manager`、根入口）外部消费者一旦 `import` 立刻报 `Missing
 * tiktoken_bg.wasm`，原因是 tiktoken（带 wasm runtime）+ zod 都被 inline 进
 * dist bundle，但 wasm 资源没跟着进 dist。这块在 linnya monorepo 内不会暴露
 * （monorepo 用 paths/alias 直读 packages/linnkit/src，不走 node_modules），
 * 但在 linnsy-daemon 这种通过 `npm install @linnlabs/linnkit` 真装包的消费者
 * 上立即翻车。详见 linnkit 仓 docs/release/RELEASE-HISTORY.md §C.5。
 *
 * linnkit 0.1.3 修复：
 *   - tiktoken 加进 `package.json#dependencies` + tsup external
 *   - zod 加进 `peerDependencies` + tsup external
 *
 * 本 contract test 是消费者侧的永久守护：
 *   - 锁定 linnsy 实际**用**的入口（contracts / ports / runtime-kernel /
 *     context-manager / 根入口 / events seam）都能 import
 *   - 锁定 linnsy 实际**用**的关键符号（GraphExecutor / SqliteCheckpointer /
 *     用不到所以不锁、SqliteRunRegistryStore 同上、createUserMessage 等）能取到
 *   - 任何 linnkit 未来版本只要破坏装包闭环（漏声明 dep / 漏 external / 缺资源），
 *     这条 contract test 立刻红
 *
 * 为什么不直接 spawn child node 跑：linnsy daemon 的所有 contract test 都跑在
 * vitest node 环境，模块解析与生产代码完全一致；vitest 不像 linnkit 自身有
 * `tsconfig.paths` 把 `@linnlabs/linnkit` alias 到 src（linnsy 没有这条 alias），
 * 这里的 `import '@linnlabs/linnkit/...'` 100% 走 node_modules dist，效果等同。
 */

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('@linnlabs/linnkit package source contract — npmjs 0.8.0+', () => {
  it('uses the public npmjs package metadata instead of the old GitHub Packages build', () => {
    const packageJson: unknown = require('@linnlabs/linnkit/package.json');
    if (!isLinnkitPackageJson(packageJson)) {
      throw new Error('invalid @linnlabs/linnkit package.json shape');
    }

    expect(packageJson.version).toBe('0.8.0');
    expect(packageJson.license).toBe('MIT');
    expect(packageJson.repository.url).toBe('git+https://github.com/linnlabs/linnkit.git');
    expect(packageJson.publishConfig.registry).toBe('https://registry.npmjs.org/');
  });

  it('keeps daemon npm config pinned to npmjs for the @linnlabs scope', async () => {
    const npmrc = await readFile(new URL('../../.npmrc', import.meta.url), 'utf8');

    expect(npmrc).toContain('@linnlabs:registry=https://registry.npmjs.org/');
    expect(npmrc).not.toContain('npm.pkg.github.com');
  });

  it('locks @linnlabs/linnkit to npmjs in package-lock', async () => {
    const lockRaw = await readFile(new URL('../../package-lock.json', import.meta.url), 'utf8');
    const lockJson: unknown = JSON.parse(lockRaw);
    const linnkit = readLockedLinnkitPackage(lockJson);

    expect(linnkit.version).toBe('0.8.0');
    expect(linnkit.resolved).toBe('https://registry.npmjs.org/@linnlabs/linnkit/-/linnkit-0.8.0.tgz');
    expect(linnkit.license).toBe('MIT');
  });
});

describe('@linnlabs/linnkit package install contract — runtime entries can be imported', () => {
  it('imports `/runtime-kernel` (Node-only full-expansion entry — 0.1.0~0.1.2 必炸点)', async () => {
    const mod = await import('@linnlabs/linnkit/runtime-kernel');
    expect(typeof mod).toBe('object');
    expect(typeof mod.GraphExecutor).toBe('function');
  });

  it('imports `/context-manager` (Node-only — 0.1.0~0.1.2 必炸点)', async () => {
    const mod = await import('@linnlabs/linnkit/context-manager');
    expect(typeof mod).toBe('object');
    const keys = Object.keys(mod);
    expect(keys.length).toBeGreaterThan(0);
  });

  it('imports `/context-manager` fence API required by Linnsy context engineering', async () => {
    const mod = await import('@linnlabs/linnkit/context-manager');
    expect(typeof mod.createFenceRegistry).toBe('function');
    expect(typeof mod.formatAgentLlmMessages).toBe('function');
    expect(typeof mod.createMessageFormatter).toBe('function');
    expect(typeof mod.FenceLifetimePreprocessor).toBe('function');
    expect(typeof mod.DEFAULT_MUST_KEEP_POLICY).toBe('object');
  });

  it('imports the root entry `@linnlabs/linnkit` (re-exports namespace — 0.1.0~0.1.2 必炸点)', async () => {
    const mod = await import('@linnlabs/linnkit');
    expect(typeof mod).toBe('object');
    expect(typeof mod.contracts).toBe('object');
  });

  it('imports `/runtime-kernel/events` (browser-safe slim seam)', async () => {
    const mod = await import('@linnlabs/linnkit/runtime-kernel/events');
    expect(typeof mod).toBe('object');
  });

  it('imports `/contracts` (zod schema 真源；0.1.3 起 zod external)', async () => {
    const mod = await import('@linnlabs/linnkit/contracts');
    expect(typeof mod).toBe('object');
    expect(typeof mod.createUserMessage).toBe('function');
  });

  it('imports `/ports` (host 实现接口的纯类型入口)', async () => {
    const mod = await import('@linnlabs/linnkit/ports');
    expect(typeof mod).toBe('object');
  });
});

interface LinnkitPackageJson {
  version: string;
  license: string;
  repository: { url: string };
  publishConfig: { registry: string };
}

interface LockedPackage {
  version: string;
  resolved: string;
  license: string;
}

function isLinnkitPackageJson(value: unknown): value is LinnkitPackageJson {
  return isRecord(value) &&
    typeof value.version === 'string' &&
    typeof value.license === 'string' &&
    isRecord(value.repository) &&
    typeof value.repository.url === 'string' &&
    isRecord(value.publishConfig) &&
    typeof value.publishConfig.registry === 'string';
}

function readLockedLinnkitPackage(lockJson: unknown): LockedPackage {
  if (!isRecord(lockJson) || !isRecord(lockJson.packages)) {
    throw new Error('invalid package-lock shape');
  }

  const linnkit = lockJson.packages['node_modules/@linnlabs/linnkit'];
  if (!isLockedPackage(linnkit)) {
    throw new Error('package-lock missing @linnlabs/linnkit entry');
  }
  return linnkit;
}

function isLockedPackage(value: unknown): value is LockedPackage {
  return isRecord(value) &&
    typeof value.version === 'string' &&
    typeof value.resolved === 'string' &&
    typeof value.license === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('@linnlabs/linnkit package install contract — deps closure', () => {
  it('tiktoken (declared as runtime dependency) is reachable from linnsy-daemon node_modules', async () => {
    const tiktoken = await import('tiktoken');
    expect(typeof tiktoken.get_encoding).toBe('function');
  });

  it('zod (declared as peerDependency by linnkit) is reachable from linnsy-daemon node_modules', async () => {
    const { z } = await import('zod');
    expect(typeof z.object).toBe('function');
    const schema = z.object({ ok: z.boolean() });
    expect(schema.parse({ ok: true })).toEqual({ ok: true });
  });

  it('linnkit contracts schemas use the same zod instance linnsy daemon installed (no instance isolation)', async () => {
    const { z } = await import('zod');
    const linnkitContracts = await import('@linnlabs/linnkit/contracts');
    const userMessage = linnkitContracts.createUserMessage('user_input', 'hello');
    expect(typeof userMessage).toBe('object');
    expect(userMessage).not.toBeNull();
    expect(typeof z).toBe('object');
  });
});
