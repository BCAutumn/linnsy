import { AsyncLocalStorage } from 'node:async_hooks';

import type { AiMessage } from '@linnlabs/linnkit/contracts';

import type { RunContextSnapshotInput } from './types.js';

export interface RunContextAuditScope {
  capture(input: Omit<RunContextSnapshotInput, 'sequence' | 'messageCount'>): void;
  snapshots(): RunContextSnapshotInput[];
}

const storage = new AsyncLocalStorage<RunContextAuditScope>();

export function createRunContextAuditScope(): RunContextAuditScope {
  const snapshots: RunContextSnapshotInput[] = [];
  return {
    capture(input): void {
      snapshots.push({
        sequence: snapshots.length + 1,
        modelId: input.modelId,
        messageCount: input.messages.length,
        messages: cloneAiMessages(input.messages)
      });
    },
    snapshots(): RunContextSnapshotInput[] {
      return snapshots.map((snapshot) => ({
        sequence: snapshot.sequence,
        modelId: snapshot.modelId,
        messageCount: snapshot.messageCount,
        messages: cloneAiMessages(snapshot.messages)
      }));
    }
  };
}

export function runWithRunContextAuditScope<T>(
  scope: RunContextAuditScope,
  operation: () => Promise<T>
): Promise<T> {
  return storage.run(scope, operation);
}

export function captureRunContextMessages(input: {
  modelId: string;
  messages: AiMessage[];
}): void {
  storage.getStore()?.capture(input);
}

function cloneAiMessages(messages: AiMessage[]): AiMessage[] {
  return messages.map((message) => structuredClone(message));
}
