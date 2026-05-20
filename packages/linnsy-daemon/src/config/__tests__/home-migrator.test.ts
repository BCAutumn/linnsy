import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';

import { createTempLinnsyHome } from '../../../__tests__/harness/temp-home.js';
import { migrateLegacyHomeIfNeeded } from '../home-migrator.js';

describe('home migrator', () => {
  test('skips migration when LINNSY_HOME is explicit', async () => {
    const root = await createTempLinnsyHome();
    const explicitHome = join(root, 'explicit');
    const prompt = vi.fn();

    try {
      const result = await migrateLegacyHomeIfNeeded({
        env: { LINNSY_HOME: explicitHome, HOME: root },
        platform: 'darwin',
        prompt
      });

      expect(result).toEqual({
        home: explicitHome,
        legacyHome: join(root, '.linnsy'),
        standardHome: join(root, 'Library', 'Application Support', 'Linnsy'),
        migrated: false,
        skippedReason: 'env_override'
      });
      expect(prompt).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('uses the OS standard home when no legacy home exists', async () => {
    const root = await createTempLinnsyHome();
    const prompt = vi.fn();

    try {
      const result = await migrateLegacyHomeIfNeeded({
        env: { HOME: root },
        platform: 'darwin',
        prompt
      });

      expect(result.home).toBe(join(root, 'Library', 'Application Support', 'Linnsy'));
      expect(result.migrated).toBe(false);
      expect(result.skippedReason).toBe('legacy_missing');
      expect(prompt).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('moves legacy home to the OS standard path and leaves a marker when approved', async () => {
    const root = await createTempLinnsyHome();
    const legacyHome = join(root, '.linnsy');
    const standardHome = join(root, 'Library', 'Application Support', 'Linnsy');

    try {
      await mkdir(legacyHome, { recursive: true });
      await writeFile(join(legacyHome, 'config.yaml'), 'profile: old\n');

      const result = await migrateLegacyHomeIfNeeded({
        env: { HOME: root },
        platform: 'darwin',
        prompt: () => Promise.resolve(true)
      });

      expect(result.home).toBe(standardHome);
      expect(result.migrated).toBe(true);
      await expect(readFile(join(standardHome, 'config.yaml'), 'utf8')).resolves.toBe('profile: old\n');
      await expect(readFile(join(legacyHome, 'MIGRATED.txt'), 'utf8')).resolves.toContain(standardHome);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('replaces an empty standard directory left by a failed first start', async () => {
    const root = await createTempLinnsyHome();
    const legacyHome = join(root, '.linnsy');
    const standardHome = join(root, 'Library', 'Application Support', 'Linnsy');

    try {
      await mkdir(legacyHome, { recursive: true });
      await mkdir(standardHome, { recursive: true });
      await writeFile(join(legacyHome, 'config.yaml'), 'profile: old\n');

      const result = await migrateLegacyHomeIfNeeded({
        env: { HOME: root },
        platform: 'darwin',
        prompt: () => Promise.resolve(true)
      });

      expect(result.home).toBe(standardHome);
      expect(result.migrated).toBe(true);
      await expect(readFile(join(standardHome, 'config.yaml'), 'utf8')).resolves.toBe('profile: old\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('keeps using legacy home when migration is declined', async () => {
    const root = await createTempLinnsyHome();
    const legacyHome = join(root, '.linnsy');

    try {
      await mkdir(legacyHome, { recursive: true });
      await writeFile(join(legacyHome, 'config.yaml'), 'profile: old\n');

      const result = await migrateLegacyHomeIfNeeded({
        env: { HOME: root },
        platform: 'darwin',
        prompt: () => Promise.resolve(false)
      });

      expect(result.home).toBe(legacyHome);
      expect(result.migrated).toBe(false);
      expect(result.skippedReason).toBe('user_declined');
      await expect(readFile(join(legacyHome, 'config.yaml'), 'utf8')).resolves.toBe('profile: old\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
