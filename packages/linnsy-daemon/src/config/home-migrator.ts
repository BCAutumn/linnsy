import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  getLegacyLinnsyHome,
  getOsStandardLinnsyHome,
  resolveDefaultLinnsyHome,
  type ResolveLinnsyHomeOptions
} from './home-resolver.js';

export type HomeMigrationSkippedReason =
  | 'env_override'
  | 'standard_exists'
  | 'legacy_missing'
  | 'user_declined';

export interface HomeMigrationPrompt {
  legacyHome: string;
  standardHome: string;
}

export interface HomeMigrationResult {
  home: string;
  legacyHome: string;
  standardHome: string;
  migrated: boolean;
  skippedReason?: HomeMigrationSkippedReason;
}

export interface MigrateLegacyHomeOptions extends ResolveLinnsyHomeOptions {
  prompt?: (request: HomeMigrationPrompt) => Promise<boolean> | boolean;
}

export async function migrateLegacyHomeIfNeeded(
  options: MigrateLegacyHomeOptions = {}
): Promise<HomeMigrationResult> {
  const env = options.env ?? process.env;
  const legacyHome = getLegacyLinnsyHome(options);
  const standardHome = getOsStandardLinnsyHome(options);

  if (env.LINNSY_HOME !== undefined && env.LINNSY_HOME.length > 0) {
    return {
      home: resolveDefaultLinnsyHome(options),
      legacyHome,
      standardHome,
      migrated: false,
      skippedReason: 'env_override'
    };
  }

  const standardExists = await pathExists(standardHome);
  if (standardExists && (await pathExists(join(standardHome, 'config.yaml')) || !await pathExists(legacyHome))) {
    return {
      home: standardHome,
      legacyHome,
      standardHome,
      migrated: false,
      skippedReason: 'standard_exists'
    };
  }

  if (!await pathExists(legacyHome)) {
    return {
      home: standardHome,
      legacyHome,
      standardHome,
      migrated: false,
      skippedReason: 'legacy_missing'
    };
  }

  if (standardExists && !await isEmptyDirectory(standardHome)) {
    return {
      home: standardHome,
      legacyHome,
      standardHome,
      migrated: false,
      skippedReason: 'standard_exists'
    };
  }

  const approved = await askForMigration(options.prompt, { legacyHome, standardHome });
  if (!approved) {
    return {
      home: legacyHome,
      legacyHome,
      standardHome,
      migrated: false,
      skippedReason: 'user_declined'
    };
  }

  if (standardExists) {
    await rm(standardHome, { recursive: true, force: true });
  }
  await mkdir(dirname(standardHome), { recursive: true });
  await rename(legacyHome, standardHome);
  await mkdir(legacyHome, { recursive: true, mode: 0o700 });
  await writeFile(
    join(legacyHome, 'MIGRATED.txt'),
    [
      'Linnsy data was migrated to the OS standard application data directory.',
      `New home: ${standardHome}`,
      ''
    ].join('\n'),
    'utf8'
  );

  return {
    home: standardHome,
    legacyHome,
    standardHome,
    migrated: true
  };
}

async function askForMigration(
  prompt: MigrateLegacyHomeOptions['prompt'],
  request: HomeMigrationPrompt
): Promise<boolean> {
  if (prompt === undefined) {
    return false;
  }
  return await prompt(request);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function isEmptyDirectory(path: string): Promise<boolean> {
  const info = await stat(path);
  if (!info.isDirectory()) {
    return false;
  }
  return (await readdir(path)).length === 0;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
