import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const electronBin = path.join(packageRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
const defaultRendererUrl = 'http://127.0.0.1:5173';
let rendererUrl = process.env.LINNSY_RENDERER_URL ?? defaultRendererUrl;
const daemonUrl = process.env.LINNSY_DAEMON_URL ?? 'http://127.0.0.1:7700';
const rendererUrlWasExplicit = process.env.LINNSY_RENDERER_URL !== undefined;

const children = new Set<ChildProcess>();

log(`building Electron main/preload`);
await runOnce(npmBin, ['run', 'build:electron']);

const rendererServer = await resolveRendererDevServer({
  requestedUrl: rendererUrl,
  explicit: rendererUrlWasExplicit
});
rendererUrl = rendererServer.url;

log(`renderer URL: ${rendererUrl}`);
log(`daemon URL: ${daemonUrl}`);
if (rendererServer.reuse) {
  log(`reusing existing renderer dev server at ${rendererUrl}`);
}
const vite = rendererServer.reuse
  ? null
  : spawnLongRunning(npmBin, ['run', 'dev:frontend'], {
      LINNSY_FRONTEND_PORT: readPort(rendererUrl)
    });
if (vite !== null) {
  log(`waiting for renderer dev server at ${rendererUrl}`);
  await waitForLinnsyRenderer(rendererUrl);
  log(`renderer ready at ${rendererUrl}`);
}

try {
  log(`launching Electron window`);
  // Electron main 会调用 resolveLocalBearerTokens 自己解析 web / wechat-gateway
  // 等本机 bearer，外部启动器不再注入硬编码 'dev-secret'，否则会污染
  // userData/local-bearer-tokens.json 让所有用户都共享同一个 dev token。
  // 开发者要显式覆盖时，仍可在自己 shell 里 export LINNSY_WEB_BEARER 等。
  await runOnce(electronBin, ['dist-electron/main.js'], {
    ELECTRON_ENABLE_LOGGING: '1',
    LINNSY_RENDERER_URL: rendererUrl,
    LINNSY_DAEMON_URL: daemonUrl,
    LINNSY_ELECTRON_SPAWN_DAEMON: process.env.LINNSY_ELECTRON_SPAWN_DAEMON ?? '1'
  });
} finally {
  log(`Electron exited`);
  if (vite !== null) {
    stopChild(vite);
  }
}

function spawnLongRunning(
  command: string,
  args: string[],
  env: Record<string, string> = {}
): ChildProcess {
  const child = spawn(command, args, {
    cwd: packageRoot,
    env: { ...process.env, ...env },
    stdio: 'inherit'
  });
  log(`started pid ${String(child.pid ?? 'unknown')}: ${command} ${args.join(' ')}`);
  children.add(child);
  child.on('exit', () => {
    children.delete(child);
  });
  child.on('error', (error) => {
    console.error(`${command} failed`, error);
  });
  return child;
}

function runOnce(
  command: string,
  args: string[],
  env: Record<string, string> = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnLongRunning(command, args, env);

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const exitCode = code === null ? 'unknown' : String(code);
      reject(new Error(`${command} exited with code ${exitCode}`));
    });
  });
}

interface RendererDevServerSelection {
  url: string;
  reuse: boolean;
}

type RendererProbeResult =
  | { kind: 'linnsy' }
  | { kind: 'foreign' }
  | { kind: 'unreachable'; error: unknown };

async function resolveRendererDevServer(input: {
  requestedUrl: string;
  explicit: boolean;
}): Promise<RendererDevServerSelection> {
  const probe = await probeRenderer(input.requestedUrl);
  if (probe.kind === 'linnsy') {
    return { url: input.requestedUrl, reuse: true };
  }
  if (probe.kind === 'unreachable') {
    return { url: input.requestedUrl, reuse: false };
  }
  if (input.explicit) {
    throw new Error(
      `renderer URL ${input.requestedUrl} is already serving a non-Linnsy app; ` +
      `stop that dev server or set LINNSY_RENDERER_URL to a Linnsy renderer URL`
    );
  }
  const fallback = await findAvailableRendererDevServer(input.requestedUrl);
  if (fallback.reuse) {
    log(`renderer port at ${input.requestedUrl} is occupied by another app; reusing Linnsy renderer at ${fallback.url}`);
    return fallback;
  }
  log(`renderer port at ${input.requestedUrl} is occupied by another app; using ${fallback.url}`);
  return fallback;
}

async function findAvailableRendererDevServer(requestedUrl: string): Promise<RendererDevServerSelection> {
  const parsed = new URL(requestedUrl);
  const startingPort = Number.parseInt(readPort(requestedUrl), 10);
  for (let offset = 1; offset <= 50; offset += 1) {
    parsed.port = String(startingPort + offset);
    const candidate = parsed.toString();
    const probe = await probeRenderer(candidate);
    if (probe.kind === 'unreachable') {
      return { url: candidate, reuse: false };
    }
    if (probe.kind === 'linnsy') {
      return { url: candidate, reuse: true };
    }
  }
  throw new Error(`could not find a free renderer port near ${requestedUrl}`);
}

async function waitForLinnsyRenderer(url: string): Promise<void> {
  const deadline = Date.now() + 30000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const result = await probeRenderer(url);
    if (result.kind === 'linnsy') {
      return;
    }
    lastError = result.kind === 'unreachable' ? result.error : new Error('non-Linnsy renderer response');
    await delay(250);
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`renderer dev server did not become ready at ${url}: ${message}`);
}

async function probeRenderer(url: string): Promise<RendererProbeResult> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { kind: 'unreachable', error: new Error(`HTTP ${response.status.toString()}`) };
    }
    const html = await response.text();
    if (html.includes('name="linnsy-renderer"') && html.includes('content="linnsy-daemon"')) {
      return { kind: 'linnsy' };
    }
    return { kind: 'foreign' };
  } catch (error: unknown) {
    return { kind: 'unreachable', error };
  }
}

function readPort(url: string): string {
  const parsed = new URL(url);
  if (parsed.port.length > 0) {
    return parsed.port;
  }
  if (parsed.protocol === 'https:') {
    return '443';
  }
  return '80';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function stopChild(child: ChildProcess): void {
  if (children.has(child)) {
    child.kill();
  }
}

function stopAllChildren(): void {
  for (const child of children) {
    child.kill();
  }
}

function log(message: string): void {
  console.info(`[linnsy dev] ${message}`);
}

process.once('SIGINT', () => {
  stopAllChildren();
  process.exitCode = 130;
});

process.once('SIGTERM', () => {
  stopAllChildren();
  process.exitCode = 143;
});
