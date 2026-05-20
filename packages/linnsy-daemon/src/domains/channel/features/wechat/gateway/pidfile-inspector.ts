import type { WechatGatewayPidfile, WechatGatewayPidfileStore } from './pidfile-store.js';

export type WechatGatewayPidfileStaleReason =
  | 'invalid-pid'
  | 'process-not-alive';

export type WechatGatewayPidfileInspection =
  | { kind: 'absent' }
  | { kind: 'stale'; pidfile: WechatGatewayPidfile; reason: WechatGatewayPidfileStaleReason }
  | { kind: 'live'; pidfile: WechatGatewayPidfile };

export interface InspectWechatGatewayPidfileOptions {
  store: WechatGatewayPidfileStore;
  isProcessAlive?: (pid: number) => boolean;
}

// 给 Electron / CLI 启动期判断"上次有没有把 sidecar 留下来当孤儿"。
// stale 时自动删 pidfile，避免这次启动后再被检测一轮；live 时只读不写，
// 由调用方决定是日志报告 / 弹对话框 / 还是 SIGTERM 接管。
export async function inspectWechatGatewayPidfile(
  options: InspectWechatGatewayPidfileOptions
): Promise<WechatGatewayPidfileInspection> {
  const isAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const pidfile = await options.store.read();
  if (pidfile === null) {
    return { kind: 'absent' };
  }

  if (!Number.isInteger(pidfile.pid) || pidfile.pid <= 0) {
    await options.store.clear();
    return { kind: 'stale', pidfile, reason: 'invalid-pid' };
  }

  if (!isAlive(pidfile.pid)) {
    await options.store.clear();
    return { kind: 'stale', pidfile, reason: 'process-not-alive' };
  }

  return { kind: 'live', pidfile };
}

// process.kill(pid, 0) 是 unix 习惯——发 0 信号只探测，不打扰目标进程。
// EPERM 表示 PID 存在但当前用户无权访问（root owned 的进程），仍视作活；
// 其他错误（主要是 ESRCH）都是 PID 不存在，视作 stale。
export function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'EPERM') {
      return true;
    }
    return false;
  }
}
