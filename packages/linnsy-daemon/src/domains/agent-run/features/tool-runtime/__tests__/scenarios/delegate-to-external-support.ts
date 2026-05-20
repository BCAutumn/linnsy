import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, expect } from 'vitest';
import type { ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';

import { createTempLinnsyHome } from '../../../../../../../__tests__/harness/temp-home.js';
import { DEFAULT_LINNSY_WORK_DIR_NAME, createLinnsyPathManager } from '../../../../../../config/path-manager.js';
import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../../shared/errors.js';
import { createTables } from '../../../../../../persistence/schema/schema-provider.js';
import { SqliteConversationStore } from '../../../../../../persistence/stores/conversation/sqlite-conversation-store.js';
import { SqliteTaskStore } from '../../../../../task/persistence/sqlite-task-store.js';
import { createLinnsyAgentRegistry } from '../../../agents/registry/registry.js';
import type { AgentDefinition } from '../../../agents/registry/types.js';
import type { TaskLocator } from '../../../../../task/definitions/task.js';
import { createTaskTracker } from '../../../../../task/features/tracker/task-tracker.js';
import { createWorkspaceManager } from '../../../../../task/features/workspace/workspace-manager.js';
import type { ExternalAgentDispatcherPort } from '../../../../../task/features/external-dispatch/types.js';
import { createMockExternalAgentDispatcher } from '../../../../../task/features/external-dispatch/mock-dispatcher.js';
import { createDelegateToExternalTool } from '../../tools/delegate-to-external.js';
import { createLinnsyToolRuntime } from '../../tool-runtime.js';

export interface Fixture {
  home: string;
  db: Database.Database;
  tasks: SqliteTaskStore;
  tracker: ReturnType<typeof createTaskTracker>;
  workspaceRoot: string;
}

const fixtures: Fixture[] = [];

export async function setup(): Promise<Fixture> {
  const home = await createTempLinnsyHome();
  const db = new Database(join(home, 'state.db'));
  createTables(db);
  const conversations = new SqliteConversationStore(db);
  const tasks = new SqliteTaskStore(db);
  const tracker = createTaskTracker({ tasks, clock: { now: () => 1_000 } });
  const workspaceRoot = join(home, 'workspaces');

  await conversations.upsert({
    conversationId: 'conv_1',
    sessionKey: 'linnsy:main:cli:private:local',
    platform: 'cli',
    chatType: 'private',
    chatId: 'local',
    createdAt: 10,
    updatedAt: 10
  });

  const fixture = { home, db, tasks, tracker, workspaceRoot };
  fixtures.push(fixture);
  return fixture;
}

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    if (fixture !== undefined) {
      fixture.db.close();
      await rm(fixture.home, { recursive: true, force: true });
    }
  }
});


export function toolContext(): ToolExecutionContext {
  return {
    runId: 'run_1',
    conversationId: 'conv_1',
    turnId: 'turn_1',
    user_query: 'delegate'
  };
}

export function externalDefinition(): AgentDefinition {
  return {
    id: 'delegate_to_codex',
    displayName: 'Codex',
    description: 'Mock Codex adapter',
    systemPromptId: 'delegate_to_codex',
    basePrompt: 'Mock Codex adapter prompt',
    modelPolicy: { model: 'default' },
    toolPolicy: { allowedToolIds: [] },
    memoryPolicy: {
      includeConversationSummary: false,
      includeLongTermMemory: false
    },
    enabled: true
  };
}

export function noopDispatcher(): ExternalAgentDispatcherPort {
  return {
    dispatch: () => Promise.resolve(),
    continue: () => Promise.resolve(),
    cancel: () => Promise.resolve()
  };
}

export function linnsyLocator(): TaskLocator {
  return projectLocator('/Users/tiansi/code/linnsy');
}

export function projectLocator(ref: string): TaskLocator {
  return {
    kind: 'directory',
    label: 'linnsy',
    ref
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
    if (!(error instanceof LinnsyError)) {
      return;
    }
    expect(error.code).toBe(code);
    expect(error.message).toContain(messagePart);
    return;
  }
  throw new Error('expected promise to reject with LinnsyError');
}

export { mkdir, rm, join, Database, DEFAULT_LINNSY_WORK_DIR_NAME, createLinnsyPathManager, LINNSY_ERROR_CODES, LinnsyError, createLinnsyAgentRegistry, createTaskTracker, createWorkspaceManager, createMockExternalAgentDispatcher, createDelegateToExternalTool, createLinnsyToolRuntime };
export type { ToolExecutionContext, AgentDefinition, ExternalAgentDispatcherPort, TaskLocator };
