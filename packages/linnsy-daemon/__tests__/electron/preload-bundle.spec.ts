import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { buildElectron } from '../../electron/build-electron.js';

const PACKAGE_ROOT = join(import.meta.dirname, '..', '..');

describe('Electron preload bundle', () => {
  test('bundles sandbox-incompatible runtime dependencies into preload.cjs', async () => {
    await buildElectron({ silent: true });

    const preload = await readFile(join(PACKAGE_ROOT, 'dist-electron', 'preload.cjs'), 'utf8');
    const bareRequires = [...preload.matchAll(/\brequire\(["']([^."'/][^"']*)["']\)/gu)]
      .map((match) => match[1])
      .sort();

    expect([...new Set(bareRequires)]).toEqual(['electron']);
  }, 20_000);
});
