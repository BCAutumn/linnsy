import type { FenceInjection } from '@linnlabs/linnkit/context-manager';

const pendingByRunId = new Map<string, FenceInjection[]>();

export function addPendingContextFence(runId: string, fence: FenceInjection): void {
  const existing = pendingByRunId.get(runId) ?? [];
  pendingByRunId.set(runId, [...existing, fence]);
}

export function consumePendingContextFences(runId: string): FenceInjection[] {
  const fences = pendingByRunId.get(runId);
  if (fences === undefined) {
    return [];
  }
  pendingByRunId.delete(runId);
  return fences;
}

export function clearPendingContextFences(runId: string): void {
  pendingByRunId.delete(runId);
}
