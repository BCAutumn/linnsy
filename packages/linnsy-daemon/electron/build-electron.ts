import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build, type Options } from 'tsup';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface BuildElectronOptions {
  silent?: boolean;
}

export async function buildElectron(options: BuildElectronOptions = {}): Promise<void> {
  await rm(path.join(packageRoot, 'dist-electron'), { recursive: true, force: true });
  for (const step of createElectronBuildSteps(options)) {
    await build(step);
  }
}

export function createElectronBuildSteps(options: BuildElectronOptions = {}): Options[] {
  return [
    {
      entry: ['electron/main.ts'],
      format: ['esm'],
      platform: 'node',
      target: 'node20',
      external: ['electron'],
      outDir: 'dist-electron',
      sourcemap: true,
      skipNodeModulesBundle: true,
      clean: false,
      dts: false,
      config: false,
      silent: options.silent === true
    },
    {
      entry: ['electron/preload.ts'],
      format: ['cjs'],
      platform: 'node',
      target: 'node20',
      external: ['electron'],
      outDir: 'dist-electron',
      sourcemap: true,
      skipNodeModulesBundle: false,
      noExternal: ['zod'],
      clean: false,
      dts: false,
      config: false,
      silent: options.silent === true
    }
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildElectron();
}
