import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../../../../__tests__/harness/temp-home.js';
import { createTables } from '../../../../../persistence/schema/schema-provider.js';
import { SqliteConversationStore } from '../../../../../persistence/stores/conversation/sqlite-conversation-store.js';
import { SqliteTaskStore } from '../../../persistence/sqlite-task-store.js';
import { LINNSY_ERROR_CODES } from '../../../../../shared/errors.js';
import { createTaskTracker } from '../../tracker/task-tracker.js';
import type {
  ExternalAgentCancelInput,
  ExternalAgentContinueInput,
  ExternalAgentDispatcherPort,
  ExternalAgentDispatchInput
} from '../types.js';
import { createRoutingExternalAgentDispatcher } from '../routing-dispatcher.js';

interface Fixture {
  home: string;
  db: Database.Database;
  tracker: ReturnType<typeof createTaskTracker>;
}

const fixtures: Fixture[] = [];

async function setup(): Promise<Fixture> {
  const home = await createTempLinnsyHome();
  const db = new Database(join(home, 'state.db'));
  createTables(db);
  const conversations = new SqliteConversationStore(db);
  const tasks = new SqliteTaskStore(db);
  const tracker = createTaskTracker({ tasks, clock: { now: () => 1_000 } });

  await conversations.upsert({
    conversationId: 'conv_1',
    sessionKey: 'linnsy:main:cli:private:local',
    platform: 'cli',
    chatType: 'private',
    chatId: 'local',
    createdAt: 10,
    updatedAt: 10
  });

  const fixture = { home, db, tracker };
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

describe('RoutingExternalAgentDispatcher', () => {
  test('routes dispatch by definitionKey and continue/cancel by task payload definitionKey', async () => {
    const fixture = await setup();
    const events: string[] = [];
    const dispatcher = createRoutingExternalAgentDispatcher({
      taskTracker: fixture.tracker,
      routes: {
        delegate_to_codex: recordingDispatcher('codex', events)
      }
    });
    await fixture.tracker.upsert({
      taskId: 'task_1',
      conversationId: 'conv_1',
      title: 'Codex task',
      status: 'dispatched',
      kind: 'external',
      payload: { definitionKey: 'delegate_to_codex' }
    });

    await dispatcher.dispatch({
      taskId: 'task_1',
      definitionKey: 'delegate_to_codex',
      locator: taskLocator(),
      workspacePath: '/tmp/task_1'
    });
    await dispatcher.continue({ taskId: 'task_1', message: '继续' });
    await dispatcher.cancel({ taskId: 'task_1', reason: '停下' });

    expect(events).toEqual([
      'codex:dispatch:task_1',
      'codex:continue:task_1:继续',
      'codex:cancel:task_1:停下'
    ]);
  });

  test('fails closed when a vendor route is not available', async () => {
    const fixture = await setup();
    const dispatcher = createRoutingExternalAgentDispatcher({
      taskTracker: fixture.tracker,
      routes: {}
    });
    await fixture.tracker.upsert({
      taskId: 'task_1',
      conversationId: 'conv_1',
      title: 'Cursor task',
      status: 'dispatched',
      kind: 'external',
      payload: { definitionKey: 'delegate_to_cursor' }
    });

    await expect(dispatcher.dispatch({
      taskId: 'task_1',
      definitionKey: 'delegate_to_cursor',
      locator: taskLocator(),
      workspacePath: '/tmp/task_1'
    })).rejects.toMatchObject({ code: LINNSY_ERROR_CODES.EXTERNAL_VENDOR_NOT_AVAILABLE });
    await expect(dispatcher.continue({
      taskId: 'task_1',
      message: '继续'
    })).rejects.toMatchObject({ code: LINNSY_ERROR_CODES.EXTERNAL_VENDOR_NOT_AVAILABLE });
  });
});

function recordingDispatcher(label: string, events: string[]): ExternalAgentDispatcherPort {
  return {
    dispatch(input: ExternalAgentDispatchInput): Promise<void> {
      events.push(`${label}:dispatch:${input.taskId}`);
      return Promise.resolve();
    },
    continue(input: ExternalAgentContinueInput): Promise<void> {
      events.push(`${label}:continue:${input.taskId}:${input.message}`);
      return Promise.resolve();
    },
    cancel(input: ExternalAgentCancelInput): Promise<void> {
      events.push(`${label}:cancel:${input.taskId}:${input.reason ?? ''}`);
      return Promise.resolve();
    }
  };
}

function taskLocator() {
  return {
    kind: 'directory' as const,
    label: 'task',
    ref: '/tmp/task_1'
  };
}
