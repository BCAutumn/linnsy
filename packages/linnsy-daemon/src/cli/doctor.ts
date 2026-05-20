import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loadLinnsyConfig, resolveLinnsyHome, type LoadLinnsyConfigOptions } from '../config/loader.js';
import { openLinnsyDatabase } from '../persistence/db.js';
import { createModelRegistry, type LinnsyModelConfig } from '../domains/llm/features/model-registry/model-registry.js';
import { isRecord } from '../shared/json.js';

export interface DoctorCheck {
  name:
    | 'config'
    | 'home_permissions'
    | 'workspace_permissions'
    | 'sqlite'
    | 'model_registry'
    | 'model_profile'
    | 'api_key_env';
  ok: boolean;
  message: string;
}

export interface DoctorResult {
  ok: boolean;
  checks: DoctorCheck[];
}

const DEFAULT_KINDS = ['secretary', 'cron_summary', 'memory_consolidate'] as const;

export async function runDoctor(options: LoadLinnsyConfigOptions = {}): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];
  const env = options.env ?? process.env;

  try {
    const config = await loadLinnsyConfig({ ...options, env });
    checks.push({ name: 'config', ok: true, message: 'Config loaded' });
    checks.push(await checkHomePermissions(config.home));
    checks.push(await checkWorkspacePermissions(config.workspace?.root ?? join(config.home, 'workspaces')));

    const db = openLinnsyDatabase(join(config.home, 'state.db'));
    try {
      checks.push({ name: 'sqlite', ok: true, message: 'SQLite schema ready' });
    } finally {
      db.close();
    }

    const registry = createModelRegistry(config);
    checks.push({ name: 'model_registry', ok: true, message: 'Default models resolved' });

    const profileFailures: string[] = [];
    for (const kind of DEFAULT_KINDS) {
      const model = registry.getDefaultModel(kind);
      const issues = validateModelProfile(model);
      for (const issue of issues) {
        profileFailures.push(`${kind} (${model.id}): ${issue}`);
      }
    }
    if (profileFailures.length === 0) {
      checks.push({ name: 'model_profile', ok: true, message: 'Default model profiles are consistent' });
    } else {
      for (const failure of profileFailures) {
        checks.push({ name: 'model_profile', ok: false, message: failure });
      }
    }

    for (const kind of DEFAULT_KINDS) {
      const model = registry.getDefaultModel(kind);
      if (model.apiKey !== undefined) {
        continue;
      }
      if (model.apiKeyEnv === undefined || env[model.apiKeyEnv] === undefined) {
        checks.push({
          name: 'api_key_env',
          ok: false,
          message: `Missing env ${model.apiKeyEnv ?? '<unset>'} for default ${kind} model ${model.id}`
        });
      }
    }

    if (!checks.some((check) => check.name === 'api_key_env' && !check.ok)) {
      checks.push({ name: 'api_key_env', ok: true, message: 'Default model API key envs found' });
    }
  } catch (error: unknown) {
    checks.push({
      name: 'config',
      ok: false,
      message: formatDoctorError(error, options, env)
    });
  }

  return {
    ok: checks.every((check) => check.ok),
    checks
  };
}

async function checkWorkspacePermissions(workspaceRoot: string): Promise<DoctorCheck> {
  try {
    await mkdir(workspaceRoot, { recursive: true, mode: 0o700 });
    const stats = await stat(workspaceRoot);
    if (!stats.isDirectory()) {
      return {
        name: 'workspace_permissions',
        ok: false,
        message: `Workspace root is not writable: ${workspaceRoot} is not a directory`
      };
    }

    const probePath = join(workspaceRoot, `.doctor-write-test-${String(process.pid)}`);
    await writeFile(probePath, 'ok', { mode: 0o600 });
    await rm(probePath, { force: true });
    return {
      name: 'workspace_permissions',
      ok: true,
      message: 'Workspace root is writable'
    };
  } catch (error: unknown) {
    if (isRecord(error) && error.code === 'EEXIST') {
      const existing = await stat(workspaceRoot).catch(() => null);
      if (existing !== null && !existing.isDirectory()) {
        return {
          name: 'workspace_permissions',
          ok: false,
          message: `Workspace root is not writable: ${workspaceRoot} is not a directory`
        };
      }
    }
    const message = error instanceof Error ? error.message : 'unknown workspace error';
    return {
      name: 'workspace_permissions',
      ok: false,
      message: `Workspace root is not writable: ${message}`
    };
  }
}

function validateModelProfile(model: LinnsyModelConfig): string[] {
  const issues: string[] = [];
  const capabilities = model.capabilities;
  const requestDefaults = model.requestDefaults;
  const providerOptions = model.providerOptions;

  if (
    capabilities?.contextWindowTokens !== undefined &&
    capabilities.maxOutputTokens !== undefined &&
    capabilities.maxOutputTokens > capabilities.contextWindowTokens
  ) {
    issues.push(
      `capabilities.max_output_tokens (${String(capabilities.maxOutputTokens)}) exceeds context_window_tokens (${String(capabilities.contextWindowTokens)})`
    );
  }

  if (capabilities?.supportsReasoning === false && model.reasoning?.enabled === true) {
    issues.push('reasoning.enabled=true but capabilities.supports_reasoning=false');
  }

  if (
    requestDefaults?.maxTokens !== undefined &&
    capabilities?.maxOutputTokens !== undefined &&
    requestDefaults.maxTokens > capabilities.maxOutputTokens
  ) {
    issues.push(
      `request_defaults.max_tokens (${String(requestDefaults.maxTokens)}) exceeds capabilities.max_output_tokens (${String(capabilities.maxOutputTokens)})`
    );
  }

  if (providerOptions?.openai !== undefined && model.apiProtocol !== 'openai_chat' && model.apiProtocol !== 'openai_responses') {
    issues.push(
      `provider_options.openai is only valid for OpenAI-compatible protocols (current protocol=${model.apiProtocol})`
    );
  }
  if (providerOptions?.anthropic !== undefined && model.apiProtocol !== 'anthropic_messages') {
    issues.push(
      `provider_options.anthropic is only valid for Anthropic-compatible protocols (current protocol=${model.apiProtocol})`
    );
  }

  return issues;
}

async function checkHomePermissions(home: string): Promise<DoctorCheck> {
  const stats = await stat(home);
  const mode = stats.mode & 0o777;
  if (mode !== 0o700) {
    return {
      name: 'home_permissions',
      ok: false,
      message: `LINNSY_HOME must be owner-only (0700), got ${mode.toString(8).padStart(4, '0')}`
    };
  }

  return {
    name: 'home_permissions',
    ok: true,
    message: 'LINNSY_HOME permissions are 0700'
  };
}

function formatDoctorError(
  error: unknown,
  options: LoadLinnsyConfigOptions,
  env: Record<string, string | undefined>
): string {
  if (isRecord(error) && error.code === 'ENOENT') {
    const configPath = options.configPath ?? join(resolveLinnsyHome(env), 'config.yaml');
    return `Config file not found at ${configPath}. Create it or set LINNSY_HOME to a directory that contains config.yaml.`;
  }

  return error instanceof Error ? error.message : 'Unknown doctor failure';
}

if (process.argv[1]?.endsWith('/doctor.ts') === true) {
  runDoctor()
    .then((result) => {
      for (const check of result.checks) {
        const status = check.ok ? 'ok' : 'fail';
        console.log(`${status} ${check.name}: ${check.message}`);
      }
      process.exitCode = result.ok ? 0 : 1;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown doctor error';
      console.error(message);
      process.exitCode = 1;
    });
}
