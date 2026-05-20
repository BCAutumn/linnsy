import type { ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';
import { expect } from 'vitest';

import type {
  MemoryItem,
  MemoryListOptions,
  MemoryProviderPort,
  MemoryUpsertInput
} from '../../../../../memory/persistence/memory-store-port.js';
import { LinnsyError } from '../../../../../../shared/errors.js';
import { createManageMemoryTool, type ManageMemoryTool } from '../../tools/manage-memory.js';

export interface ManageMemoryFixture {
  store: FakeMemoryStore;
  tool: ManageMemoryTool;
}

export class FakeMemoryStore implements MemoryProviderPort {
  private readonly items = new Map<string, MemoryItem>();
  private nextAutoId = 0;

  public constructor(private readonly now: () => number = () => 1_000) {}

  public list(options: MemoryListOptions = {}): Promise<MemoryItem[]> {
    return Promise.resolve(this.query(options));
  }

  public recall(options: MemoryListOptions = {}): Promise<MemoryItem[]> {
    return Promise.resolve(this.query(options));
  }

  public upsert(input: MemoryUpsertInput): Promise<MemoryItem> {
    const memoryId = input.memoryId ?? `fake_${String(this.nextAutoId += 1)}`;
    const existing = this.items.get(memoryId);
    const current = this.now();
    const item: MemoryItem = {
      memoryId,
      scope: input.scope.trim(),
      body: input.body.trim(),
      createdAt: existing?.createdAt ?? current,
      updatedAt: current,
      ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
      ...(input.metadata === undefined ? {} : { metadata: { ...input.metadata } })
    };
    this.items.set(memoryId, item);
    return Promise.resolve({ ...item, ...(item.metadata === undefined ? {} : { metadata: { ...item.metadata } }) });
  }

  public remove(memoryId: string): Promise<boolean> {
    return Promise.resolve(this.items.delete(memoryId));
  }

  public seed(item: MemoryItem): void {
    this.items.set(item.memoryId, { ...item, ...(item.metadata === undefined ? {} : { metadata: { ...item.metadata } }) });
  }

  public get(memoryId: string): MemoryItem | undefined {
    const item = this.items.get(memoryId);
    return item === undefined
      ? undefined
      : { ...item, ...(item.metadata === undefined ? {} : { metadata: { ...item.metadata } }) };
  }

  private query(options: MemoryListOptions): MemoryItem[] {
    const limit = options.limit ?? 50;
    return [...this.items.values()]
      .filter((item) => options.scope === undefined || item.scope === options.scope)
      .filter((item) => options.query === undefined || item.body.includes(options.query))
      .sort((left, right) => right.updatedAt - left.updatedAt || left.memoryId.localeCompare(right.memoryId))
      .slice(0, limit)
      .map((item) => ({ ...item, ...(item.metadata === undefined ? {} : { metadata: { ...item.metadata } }) }));
  }
}

export function createFixture(options: {
  now?: () => number;
  memoryIdFactory?: (scope: 'long_term_memory' | 'user_preference') => string;
} = {}): ManageMemoryFixture {
  const store = new FakeMemoryStore(options.now);
  return {
    store,
    tool: createManageMemoryTool({
      memoryStore: store,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.memoryIdFactory === undefined ? {} : { memoryIdFactory: options.memoryIdFactory })
    })
  };
}

export function toolContext(): ToolExecutionContext {
  return {
    runId: 'run_1',
    conversationId: 'conv_1',
    turnId: 'turn_1',
    user_query: '记一下'
  };
}

export async function expectLinnsyError(
  promise: Promise<unknown>,
  code: string,
  messagePart: string
): Promise<void> {
  try {
    await promise;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(LinnsyError);
    if (error instanceof LinnsyError) {
      expect(error.code).toBe(code);
      expect(error.message).toContain(messagePart);
    }
    return;
  }
  throw new Error(`Expected LinnsyError ${code}`);
}
