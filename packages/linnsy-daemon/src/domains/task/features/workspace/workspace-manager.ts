import { mkdir, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../shared/errors.js';

import type { WorkspaceFileEntry, WorkspacePort, WorkspaceSubdir } from './definitions/types.js';

export interface CreateWorkspaceManagerOptions {
  root: string;
}

export function createWorkspaceManager(options: CreateWorkspaceManagerOptions): WorkspacePort {
  return {
    async create(taskId: string): Promise<string> {
      const workspacePath = join(options.root, taskId);
      try {
        await mkdir(join(workspacePath, 'inputs'), { recursive: true, mode: 0o700 });
        await mkdir(join(workspacePath, 'outputs'), { recursive: true, mode: 0o700 });
        await mkdir(join(workspacePath, 'notes'), { recursive: true, mode: 0o700 });
        await mkdir(join(workspacePath, 'transcripts'), { recursive: true, mode: 0o700 });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'unknown workspace error';
        throw new LinnsyError(
          LINNSY_ERROR_CODES.WORKSPACE_INIT_FAILED,
          `failed to create workspace for task ${taskId}: ${message}`,
          true
        );
      }
      return workspacePath;
    },

    async resolve(taskId: string): Promise<string | null> {
      const workspacePath = join(options.root, taskId);
      try {
        const stats = await stat(workspacePath);
        return stats.isDirectory() ? workspacePath : null;
      } catch {
        return null;
      }
    },

    async list(taskId: string, subdir?: WorkspaceSubdir): Promise<WorkspaceFileEntry[]> {
      const workspacePath = await this.resolve(taskId);
      if (workspacePath === null) {
        return [];
      }

      const roots = subdir === undefined
        ? ['inputs', 'outputs', 'notes', 'transcripts'] satisfies WorkspaceSubdir[]
        : [subdir];
      const entries: WorkspaceFileEntry[] = [];
      for (const root of roots) {
        await collectFiles(workspacePath, join(workspacePath, root), entries);
      }
      return entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    }
  };
}

async function collectFiles(
  workspacePath: string,
  directory: string,
  entries: WorkspaceFileEntry[]
): Promise<void> {
  let dirents;
  try {
    dirents = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const dirent of dirents) {
    const absolutePath = join(directory, dirent.name);
    if (dirent.isDirectory()) {
      await collectFiles(workspacePath, absolutePath, entries);
    } else if (dirent.isFile()) {
      const stats = await stat(absolutePath);
      entries.push({
        relativePath: relative(workspacePath, absolutePath),
        absolutePath,
        sizeBytes: stats.size,
        modifiedAt: stats.mtimeMs
      });
    }
  }
}
