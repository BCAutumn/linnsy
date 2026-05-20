import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../__tests__/harness/temp-home.js';
import {
  DEFAULT_LINNSY_WORK_DIR_NAME,
  createLinnsyPathManager,
  resolveDefaultAuditRoot,
  resolveDefaultAuditLogPath,
  resolveDefaultRunContextAuditLogPath,
  resolveDefaultLinnsyWorkRoot,
  resolveDefaultTaskWorkspaceRoot
} from '../path-manager.js';

describe('path manager', () => {
  test('keeps Linnsy home, task workspace, and user work roots separate', () => {
    const manager = createLinnsyPathManager({
      env: { HOME: '/Users/alice' },
      platform: 'darwin',
      linnsyHome: '/Users/alice/Library/Application Support/Linnsy'
    });

    expect(manager.linnsyHome).toBe('/Users/alice/Library/Application Support/Linnsy');
    expect(manager.auditRoot).toBe('/Users/alice/Library/Application Support/Linnsy/audit');
    expect(manager.taskWorkspaceRoot).toBe('/Users/alice/Library/Application Support/Linnsy/workspaces');
    expect(manager.auditLogPath).toBe('/Users/alice/Library/Application Support/Linnsy/audit/decisions.jsonl');
    expect(manager.runContextAuditLogPath).toBe('/Users/alice/Library/Application Support/Linnsy/audit/run-context.jsonl');
    expect(manager.linnsyWorkRoot).toBe(join('/Users/alice', DEFAULT_LINNSY_WORK_DIR_NAME));
  });

  test('resolves default roots without duplicating string literals across callers', () => {
    expect(resolveDefaultTaskWorkspaceRoot('/tmp/linnsy')).toBe('/tmp/linnsy/workspaces');
    expect(resolveDefaultAuditRoot('/tmp/linnsy')).toBe('/tmp/linnsy/audit');
    expect(resolveDefaultAuditLogPath('/tmp/linnsy')).toBe('/tmp/linnsy/audit/decisions.jsonl');
    expect(resolveDefaultRunContextAuditLogPath('/tmp/linnsy')).toBe('/tmp/linnsy/audit/run-context.jsonl');
    expect(resolveDefaultLinnsyWorkRoot({
      env: { HOME: '/Users/alice' },
      platform: 'darwin'
    })).toBe(join('/Users/alice', DEFAULT_LINNSY_WORK_DIR_NAME));
  });

  test('creates readable Linnsy Work child directories with sanitized slugs', async () => {
    const home = await createTempLinnsyHome();
    const linnsyWorkRoot = join(home, DEFAULT_LINNSY_WORK_DIR_NAME);
    const manager = createLinnsyPathManager({
      env: { HOME: home },
      platform: 'darwin',
      linnsyHome: join(home, 'Library', 'Application Support', 'Linnsy'),
      linnsyWorkRoot,
      clock: { now: () => new Date('2026-05-10T08:00:00').getTime() }
    });

    try {
      const created = await manager.createDefaultUserWorkDirectory({
        title: '写 PPT / Q3: 销售?',
        prompt: '请生成一个销售复盘 deck'
      });

      expect(created.root).toBe(linnsyWorkRoot);
      expect(created.slug).toBe('写-PPT-Q3-销售-请生成一个销售复盘-deck-20260510');
      expect(created.directory).toBe(join(linnsyWorkRoot, created.slug));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('adds a numeric suffix when a slug already exists', async () => {
    const home = await createTempLinnsyHome();
    const linnsyWorkRoot = join(home, DEFAULT_LINNSY_WORK_DIR_NAME);
    const manager = createLinnsyPathManager({
      env: { HOME: home },
      linnsyWorkRoot,
      clock: { now: () => new Date('2026-05-10T08:00:00').getTime() }
    });

    try {
      await mkdir(join(linnsyWorkRoot, '报告-20260510'), { recursive: true });
      const created = await manager.createDefaultUserWorkDirectory({ title: '报告' });
      expect(created.slug).toBe('报告-20260510-2');
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
