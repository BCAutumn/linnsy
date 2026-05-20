import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createFileAudit, noopAudit } from '@linnlabs/linnkit/runtime-kernel';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../../../../__tests__/harness/temp-home.js';
import { createTables } from '../../../../../persistence/schema/schema-provider.js';
import { SqliteConversationStore } from '../../../../../persistence/stores/conversation/sqlite-conversation-store.js';
import { SqliteRunRegistryStore } from '../../../../../persistence/stores/run/sqlite-run-registry-store.js';
import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../shared/errors.js';
import { createLinnsyAgentRegistry } from '../../agents/registry/registry.js';
import { LINNSY_MAIN_AGENT_ID } from '../../agents/index.js';
import { createLinnsyRunSpawner } from '../run-spawner.js';
import type {
  RunExecutionContext,
  RunExecutorPort,
  RunOutcome,
  RunTerminalEvent
} from '../types.js';

interface Fixture {
  conversations: SqliteConversationStore;
  runRegistry: SqliteRunRegistryStore;
  registry: ReturnType<typeof createLinnsyAgentRegistry>;
  spawner: ReturnType<typeof createLinnsyRunSpawner>;
  setNow(value: number): void;
  cleanup(): Promise<void>;
  invocations: RunExecutionContext[];
  home: string;
}

async function createFixture(executor: RunExecutorPort, initialNow = 1_000): Promise<Fixture> {
  const home = await createTempLinnsyHome();
  const db = new Database(join(home, 'state.db'));
  createTables(db);
  const conversations = new SqliteConversationStore(db);
  const runRegistry = new SqliteRunRegistryStore(db);
  const registry = createLinnsyAgentRegistry();
  let now = initialNow;
  const invocations: RunExecutionContext[] = [];
  const trackedExecutor: RunExecutorPort = {
    execute(context) {
      invocations.push(context);
      return executor.execute(context);
    }
  };
  let counter = 0;
  const spawner = createLinnsyRunSpawner({
    registry,
    conversations,
    runRegistry,
    executor: trackedExecutor,
    auditPort: noopAudit,
    clock: { now: () => now },
    runIdFactory: () => `run_${(counter += 1).toString()}`
  });

  await conversations.upsert({
    conversationId: 'conv_1',
    sessionKey: 'linnsy:main:cli:private:local',
    platform: 'cli',
    chatType: 'private',
    chatId: 'local',
    createdAt: 100,
    updatedAt: 100
  });

  return {
    conversations,
    runRegistry,
    registry,
    spawner,
    invocations,
    home,
    setNow(value: number) {
      now = value;
    },
    async cleanup() {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  };
}

const fixtures: Fixture[] = [];

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    if (fixture !== undefined) {
      await fixture.cleanup();
    }
  }
});

function track(fixture: Fixture): Promise<Fixture> {
  fixtures.push(fixture);
  return Promise.resolve(fixture);
}

function requireFindActive(fixture: Fixture): NonNullable<Fixture['spawner']['findActiveByConversation']> {
  const spawner = fixture.spawner;
  if (spawner.findActiveByConversation === undefined) {
    throw new Error('spawner should expose findActiveByConversation');
  }
  return (conversationId) => {
    if (spawner.findActiveByConversation === undefined) {
      throw new Error('spawner should expose findActiveByConversation');
    }
    return spawner.findActiveByConversation(conversationId);
  };
}

describe('createLinnsyRunSpawner', () => {
  test('persists completed run with executor outcome', async () => {
    const fixture = await track(
      await createFixture({
        execute(): Promise<RunOutcome> {
          return Promise.resolve({ status: 'completed', finalAnswer: 'pong', currentNode: 'final' });
        }
      })
    );

    const result = await fixture.spawner.spawnDetached({
      definitionKey: LINNSY_MAIN_AGENT_ID,
      conversationId: 'conv_1',
      query: 'ping',
      blocking: true
    });
    const runId = result.runId;
    await fixture.spawner.drain();

    const snapshot = await fixture.spawner.peek(runId);
    expect(snapshot?.status).toBe('completed');
    expect(snapshot?.currentNode).toBe('final');
    expect(snapshot?.error).toBeUndefined();
    expect(fixture.invocations[0]?.definition.id).toBe(LINNSY_MAIN_AGENT_ID);
  });

  test('waitForTerminal replays a completed run without using unstable lifecycle events', async () => {
    const fixture = await track(
      await createFixture({
        execute(): Promise<RunOutcome> {
          return Promise.resolve({ status: 'completed', finalAnswer: 'pong', currentNode: 'final' });
        }
      })
    );

    const spawn = await fixture.spawner.spawnDetached({
      definitionKey: LINNSY_MAIN_AGENT_ID,
      conversationId: 'conv_1',
      query: 'ping',
      blocking: true
    });

    const terminal: RunTerminalEvent = await fixture.spawner.waitForTerminal(spawn.runId);

    expect(terminal).toMatchObject({
      runId: spawn.runId,
      type: 'completed',
      outcome: { status: 'completed', finalAnswer: 'pong', currentNode: 'final' }
    });
    expect(terminal.snapshot?.status).toBe('completed');
  });

  test('waitForTerminal resolves a waiter attached before executor completion', async () => {
    let finish: ((outcome: RunOutcome) => void) | undefined;
    let markEntered: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const fixture = await track(
      await createFixture({
        execute(): Promise<RunOutcome> {
          markEntered?.();
          return new Promise((resolve) => {
            finish = resolve;
          });
        }
      })
    );

    const spawn = await fixture.spawner.spawnDetached({
      definitionKey: LINNSY_MAIN_AGENT_ID,
      conversationId: 'conv_1',
      query: 'ping'
    });
    await entered;
    const terminalPromise = fixture.spawner.waitForTerminal(spawn.runId);

    finish?.({ status: 'completed', finalAnswer: 'late pong' });

    await expect(terminalPromise).resolves.toMatchObject({
      runId: spawn.runId,
      type: 'completed',
      outcome: { status: 'completed', finalAnswer: 'late pong' }
    });
  });

  test('findActiveByConversation returns only foreground active runs for the same conversation', async () => {
    let finish: ((outcome: RunOutcome) => void) | undefined;
    let markEntered: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const fixture = await track(
      await createFixture({
        execute(): Promise<RunOutcome> {
          markEntered?.();
          return new Promise((resolve) => {
            finish = resolve;
          });
        }
      })
    );

    const spawn = await fixture.spawner.spawnDetached({
      definitionKey: LINNSY_MAIN_AGENT_ID,
      conversationId: 'conv_1',
      query: 'keep working'
    });
    await entered;
    const findActive = requireFindActive(fixture);

    await expect(findActive('conv_1')).resolves.toMatchObject({
      runId: spawn.runId,
      conversationId: 'conv_1',
      status: 'running'
    });
    await expect(findActive('other_conv')).resolves.toBeNull();

    finish?.({ status: 'completed', finalAnswer: 'done' });
    await fixture.spawner.drain();
    await expect(findActive('conv_1')).resolves.toBeNull();
  });

  test('findActiveByConversation ignores internal child agent runs', async () => {
    let markEntered: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const fixture = await track(
      await createFixture({
        execute(context): Promise<RunOutcome> {
          markEntered?.();
          return new Promise((resolve) => {
            context.signal.addEventListener('abort', () => {
              resolve({ status: 'cancelled' });
            }, { once: true });
          });
        }
      })
    );

    const spawn = await fixture.spawner.spawnDetached({
      definitionKey: LINNSY_MAIN_AGENT_ID,
      conversationId: 'conv_1',
      query: 'child work',
      parentRunId: 'run_parent',
      metadata: { internalSubAgent: true }
    });
    await entered;
    const findActive = requireFindActive(fixture);

    await expect(findActive('conv_1')).resolves.toBeNull();

    await fixture.spawner.cancel(spawn.runId);
  });

  test('rejects unknown definitionKey with LINNSY_DEFINITION_NOT_FOUND', async () => {
    const fixture = await track(
      await createFixture({
        execute(): Promise<RunOutcome> {
          return Promise.resolve({ status: 'completed' });
        }
      })
    );
    await expect(
      fixture.spawner.spawnDetached({
        definitionKey: 'ghost',
        conversationId: 'conv_1',
        query: 'noop'
      })
    ).rejects.toMatchObject({
      code: LINNSY_ERROR_CODES.DEFINITION_NOT_FOUND
    });
  });

  test('rejects missing conversation with LINNSY_SESSION_NOT_FOUND', async () => {
    const fixture = await track(
      await createFixture({
        execute(): Promise<RunOutcome> {
          return Promise.resolve({ status: 'completed' });
        }
      })
    );
    await expect(
      fixture.spawner.spawnDetached({
        definitionKey: LINNSY_MAIN_AGENT_ID,
        conversationId: 'missing',
        query: 'noop'
      })
    ).rejects.toBeInstanceOf(LinnsyError);
  });

  test('marks run as failed when executor throws', async () => {
    const fixture = await track(
      await createFixture({
        execute(): Promise<RunOutcome> {
          return Promise.reject(new Error('boom'));
        }
      })
    );
    const result = await fixture.spawner.spawnDetached({
      definitionKey: LINNSY_MAIN_AGENT_ID,
      conversationId: 'conv_1',
      query: 'ping',
      blocking: true
    });
    const snapshot = await fixture.spawner.peek(result.runId);
    expect(snapshot?.status).toBe('failed');
    expect(snapshot?.error?.code).toBe(LINNSY_ERROR_CODES.RUN_EXECUTOR_FAILED);
    expect(snapshot?.error?.message).toBe('boom');
  });

  test('cancel aborts executor signal and marks status cancelled', async () => {
    let cancelObserved = false;
    let executorEntered: ((context: RunExecutionContext) => void) | undefined;
    const enteredPromise = new Promise<RunExecutionContext>((resolve) => {
      executorEntered = resolve;
    });
    const fixture = await track(
      await createFixture({
        execute(context) {
          executorEntered?.(context);
          return new Promise<RunOutcome>((resolve) => {
            const finish = (): void => {
              cancelObserved = true;
              resolve({ status: 'cancelled' });
            };
            if (context.signal.aborted) {
              finish();
              return;
            }
            context.signal.addEventListener('abort', finish, { once: true });
          });
        }
      })
    );

    const spawn = await fixture.spawner.spawnDetached({
      definitionKey: LINNSY_MAIN_AGENT_ID,
      conversationId: 'conv_1',
      query: 'ping'
    });
    await enteredPromise;
    await fixture.spawner.cancel(spawn.runId);

    expect(cancelObserved).toBe(true);
    const snapshot = await fixture.spawner.peek(spawn.runId);
    expect(snapshot?.status).toBe('cancelled');
  });

  test('writes run cancel audit envelopes to the file audit sink only', async () => {
    const fixture = await track(
      await createFixture({
        execute(): Promise<RunOutcome> {
          return Promise.resolve({ status: 'completed' });
        }
      })
    );
    let markEntered: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const auditLogPath = join(fixture.home, 'audit.log');
    const spawner = createLinnsyRunSpawner({
      registry: fixture.registry,
      conversations: fixture.conversations,
      runRegistry: fixture.runRegistry,
      executor: {
        execute(context) {
          fixture.invocations.push(context);
          markEntered?.();
          return new Promise<RunOutcome>((resolve) => {
            context.signal.addEventListener('abort', () => {
              resolve({ status: 'cancelled' });
            }, { once: true });
          });
        }
      },
      auditPort: createFileAudit({ filePath: auditLogPath }),
      clock: { now: () => 2_000 },
      runIdFactory: () => 'run_audit'
    });

    const spawn = await spawner.spawnDetached({
      definitionKey: LINNSY_MAIN_AGENT_ID,
      conversationId: 'conv_1',
      query: 'cancel me'
    });
    await entered;
    await spawner.cancel(spawn.runId);

    const envelopes = (await readFile(auditLogPath, 'utf8'))
      .trim()
      .split('\n')
      .map(parseJsonObject)
      .filter((envelope): envelope is Record<string, unknown> => envelope !== null);
    const cancelEnvelope = envelopes.find((envelope) => envelope.action === 'run.cancel');
    expect(cancelEnvelope).toMatchObject({
      runId: 'run_audit',
      action: 'run.cancel',
      decision: { outcome: 'cancelled' },
      scope: {
        conversationId: 'conv_1',
        runId: 'run_audit'
      }
    });
  });

  test('cancel marks persisted active run as cancelled when no in-flight handle exists', async () => {
    const fixture = await track(
      await createFixture({
        execute(): Promise<RunOutcome> {
          return Promise.resolve({ status: 'completed' });
        }
      })
    );
    await fixture.runRegistry.save({
      runId: 'persisted_active',
      conversationId: 'conv_1',
      status: 'running',
      startedAt: 100,
      updatedAt: 100
    });

    await fixture.spawner.cancel('persisted_active');

    const snapshot = await fixture.spawner.peek('persisted_active');
    expect(snapshot?.status).toBe('cancelled');
  });

  test('recoverOnBoot marks orphaned runs as abandoned', async () => {
    const fixture = await track(
      await createFixture({
        execute(): Promise<RunOutcome> {
          return Promise.resolve({ status: 'completed' });
        }
      })
    );
    await fixture.runRegistry.save({
      runId: 'orphan_1',
      conversationId: 'conv_1',
      status: 'running',
      startedAt: 100,
      updatedAt: 100
    });
    const result = await fixture.spawner.recoverOnBoot();
    expect(result.abandoned).toBe(1);
    const snapshot = await fixture.spawner.peek('orphan_1');
    expect(snapshot?.status).toBe('failed');
    expect(snapshot?.error?.code).toBe(LINNSY_ERROR_CODES.RUN_ABANDONED);
  });
});

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
