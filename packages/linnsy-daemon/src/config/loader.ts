import { chmod, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { ZodError } from 'zod';

import { type LinnsyConfig, linnsyConfigSchema } from './schema.js';
import { migrateLegacyHomeIfNeeded } from './home-migrator.js';
import { resolveDefaultLinnsyHome, resolveDefaultTaskWorkspaceRoot } from './path-manager.js';

export interface LoadLinnsyConfigOptions {
  env?: Record<string, string | undefined>;
  configPath?: string;
}

export async function loadLinnsyConfig(options: LoadLinnsyConfigOptions = {}): Promise<LinnsyConfig> {
  const env = options.env ?? process.env;
  const migration = await migrateLegacyHomeIfNeeded({
    env,
    prompt: () => true
  });
  const home = migration.home;
  await mkdir(home, { recursive: true, mode: 0o700 });
  await chmod(home, 0o700);

  const configPath = options.configPath ?? join(home, 'config.yaml');
  const rawConfig = await readFile(configPath, 'utf8');
  const parsedConfig = parse(rawConfig) as unknown;

  try {
    const config = linnsyConfigSchema.parse(parsedConfig);
    return {
      ...config,
      home,
      workspace: {
        root: config.workspace?.root ?? resolveDefaultTaskWorkspaceRoot(home)
      }
    };
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      const fields = error.issues.map((issue) => issue.path.join('.') || '<root>').join(', ');
      throw new Error(`Invalid linnsy config fields: ${fields}`);
    }

    throw error;
  }
}

export function resolveLinnsyHome(env: Record<string, string | undefined> = process.env): string {
  return resolveDefaultLinnsyHome({ env });
}
