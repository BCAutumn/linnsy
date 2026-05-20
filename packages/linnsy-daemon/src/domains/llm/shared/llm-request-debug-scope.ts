import { AsyncLocalStorage } from 'node:async_hooks';

import type { LlmRequestDebugScope } from './llm-request-debug-observer.js';

const storage = new AsyncLocalStorage<LlmRequestDebugScope>();

export function runWithLlmRequestDebugScope<T>(
  scope: LlmRequestDebugScope,
  operation: () => Promise<T>
): Promise<T> {
  return storage.run(scope, operation);
}

export function readLlmRequestDebugScope(): LlmRequestDebugScope | undefined {
  return storage.getStore();
}
