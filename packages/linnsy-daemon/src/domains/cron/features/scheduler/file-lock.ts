import { mkdir, open, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { CronTickLockHandle, CronTickLockPort } from './definitions/types.js';

export class FileCronTickLock implements CronTickLockPort {
  public constructor(private readonly lockPath: string) {}

  public async acquire(): Promise<CronTickLockHandle | null> {
    await mkdir(dirname(this.lockPath), { recursive: true, mode: 0o700 });

    try {
      const handle = await open(this.lockPath, 'wx', 0o600);
      return {
        release: async () => {
          await handle.close();
          await unlink(this.lockPath).catch((error: unknown) => {
            if (!isNotFoundError(error)) {
              throw error;
            }
          });
        }
      };
    } catch (error: unknown) {
      if (isAlreadyExistsError(error)) {
        return null;
      }
      throw error;
    }
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
