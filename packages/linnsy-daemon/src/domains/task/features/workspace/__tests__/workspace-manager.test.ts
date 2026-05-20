import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../../../../__tests__/harness/temp-home.js';
import { LINNSY_ERROR_CODES } from '../../../../../shared/errors.js';
import { createWorkspaceManager } from '../workspace-manager.js';

describe('WorkspaceManager', () => {
  test('creates the task workspace with the four S3 subdirectories', async () => {
    const home = await createTempLinnsyHome();
    try {
      const root = join(home, 'workspaces');
      const manager = createWorkspaceManager({ root });

      await expect(manager.create('task_1')).resolves.toBe(join(root, 'task_1'));

      await expect(manager.resolve('task_1')).resolves.toBe(join(root, 'task_1'));
      await expect(manager.resolve('missing')).resolves.toBeNull();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('wraps workspace creation failures in LINNSY_WORKSPACE_INIT_FAILED', async () => {
    const home = await createTempLinnsyHome();
    try {
      const root = join(home, 'workspaces');
      await writeFile(root, 'not a directory');
      const manager = createWorkspaceManager({ root });

      await expect(manager.create('task_1')).rejects.toMatchObject({
        code: LINNSY_ERROR_CODES.WORKSPACE_INIT_FAILED
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('lists workspace files without reading their contents', async () => {
    const home = await createTempLinnsyHome();
    try {
      const root = join(home, 'workspaces');
      const manager = createWorkspaceManager({ root });
      const workspacePath = await manager.create('task_1');
      await writeFile(join(workspacePath, 'outputs', 'result.txt'), 'done');
      await mkdir(join(workspacePath, 'notes', 'nested'), { recursive: true });
      await writeFile(join(workspacePath, 'notes', 'nested', 'scratch.md'), 'notes');

      const allFiles = await manager.list('task_1');
      expect(allFiles.map((file) => file.relativePath)).toEqual([
        'notes/nested/scratch.md',
        'outputs/result.txt'
      ]);
      expect(allFiles[0]).toMatchObject({
        absolutePath: join(workspacePath, 'notes', 'nested', 'scratch.md'),
        sizeBytes: 5
      });
      expect(typeof allFiles[0]?.modifiedAt).toBe('number');

      await expect(manager.list('task_1', 'outputs')).resolves.toEqual([
        expect.objectContaining({
          relativePath: 'outputs/result.txt',
          absolutePath: join(workspacePath, 'outputs', 'result.txt'),
          sizeBytes: 4
        })
      ]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('returns an empty list for a missing workspace or empty subdirectory', async () => {
    const home = await createTempLinnsyHome();
    try {
      const root = join(home, 'workspaces');
      const manager = createWorkspaceManager({ root });
      await manager.create('task_1');

      await expect(manager.list('missing')).resolves.toEqual([]);
      await expect(manager.list('task_1', 'outputs')).resolves.toEqual([]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
