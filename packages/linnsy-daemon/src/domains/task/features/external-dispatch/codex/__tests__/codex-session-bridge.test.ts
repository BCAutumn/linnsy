import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import type { TaskRecord } from '../../../../definitions/task.js';
import { createCodexSessionBridge } from '../codex-session-bridge.js';

describe('CodexSessionBridge', () => {
  test('summarizes a Codex task without exposing the raw payload object', () => {
    const bridge = createCodexSessionBridge({
      maxPromptPreviewChars: 16,
      maxFinalMessagePreviewChars: 16
    });

    const snapshot = bridge.summarizeTask(sampleCodexTask({
      payload: {
        definitionKey: 'delegate_to_codex',
        prompt: '请在这个项目里深入研究 Codex 可见接管。'
      },
      result: {
        finalMessage: '已经完成研究，并写入计划文档。'
      }
    }));

    expect(snapshot).toEqual({
      taskId: 'task_1',
      title: '研究 Codex 可见接管',
      status: 'completed',
      locator: {
        kind: 'directory',
        label: 'linnsy',
        ref: '/Users/tiansi/code/linnsy'
      },
      workspacePath: '/tmp/task_1',
      sessionId: '019e-session',
      promptPreview: '请在这个项目里深入研究 Cod…',
      finalMessagePreview: '已经完成研究，并写入计划文档。',
      canOpen: true
    });
  });

  test('lists recent Codex thread metadata from index and session meta only', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'linnsy-codex-session-'));
    const sessionsDir = join(codexHome, 'sessions', '2026', '05', '14');
    try {
      await mkdir(sessionsDir, { recursive: true });
      await writeFile(join(codexHome, 'session_index.jsonl'), [
        JSON.stringify({ id: 'older', thread_name: '旧对话', updated_at: '2026-05-13T10:00:00.000Z' }),
        JSON.stringify({ id: 'newer', thread_name: '新对话', updated_at: '2026-05-14T10:00:00.000Z' })
      ].join('\n'));
      await writeFile(join(sessionsDir, 'session-newer.jsonl'), [
        JSON.stringify({
          type: 'session_meta',
          payload: {
            id: 'newer',
            cwd: '/Users/tiansi/code/linnsy',
            source: 'exec',
            originator: 'codex_exec'
          }
        }),
        JSON.stringify({ type: 'turn', payload: { text: '正文不应该被桥读取或返回' } })
      ].join('\n'));

      const bridge = createCodexSessionBridge({ codexHome });
      const threads = await bridge.listRecentThreads({ limit: 1 });

      expect(threads).toEqual([{
        id: 'newer',
        threadName: '新对话',
        updatedAt: Date.parse('2026-05-14T10:00:00.000Z'),
        cwd: '/Users/tiansi/code/linnsy',
        source: 'exec',
        originator: 'codex_exec'
      }]);
    } finally {
      await rm(codexHome, { recursive: true, force: true });
    }
  });

  test('filters Codex threads by project cwd before applying limit', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'linnsy-codex-session-'));
    const sessionsDir = join(codexHome, 'sessions', '2026', '05', '20');
    try {
      await mkdir(sessionsDir, { recursive: true });
      await writeFile(join(codexHome, 'session_index.jsonl'), [
        JSON.stringify({ id: 'other', thread_name: '别的项目', updated_at: '2026-05-20T12:00:00.000Z' }),
        JSON.stringify({ id: 'child', thread_name: '子目录', updated_at: '2026-05-20T11:00:00.000Z' }),
        JSON.stringify({ id: 'target', thread_name: '当前项目', updated_at: '2026-05-20T10:00:00.000Z' })
      ].join('\n'));
      await writeSessionMeta(sessionsDir, 'other', '/Users/tiansi/code/other');
      await writeSessionMeta(sessionsDir, 'child', '/Users/tiansi/code/linnsy/packages/app');
      await writeSessionMeta(sessionsDir, 'target', '/Users/tiansi/code/linnsy');

      const bridge = createCodexSessionBridge({ codexHome });

      await expect(bridge.listRecentThreads({
        cwd: '/Users/tiansi/code/linnsy',
        limit: 1
      })).resolves.toEqual([{
        id: 'target',
        threadName: '当前项目',
        updatedAt: Date.parse('2026-05-20T10:00:00.000Z'),
        cwd: '/Users/tiansi/code/linnsy',
        isChildOfRequestedCwd: false
      }]);

      await expect(bridge.listRecentThreads({
        cwd: '/Users/tiansi/code/linnsy',
        includeChildDirectories: true,
        limit: 2
      })).resolves.toEqual([{
        id: 'child',
        threadName: '子目录',
        updatedAt: Date.parse('2026-05-20T11:00:00.000Z'),
        cwd: '/Users/tiansi/code/linnsy/packages/app',
        isChildOfRequestedCwd: true
      }, {
        id: 'target',
        threadName: '当前项目',
        updatedAt: Date.parse('2026-05-20T10:00:00.000Z'),
        cwd: '/Users/tiansi/code/linnsy',
        isChildOfRequestedCwd: false
      }]);
    } finally {
      await rm(codexHome, { recursive: true, force: true });
    }
  });

  test('groups Codex threads by project cwd', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'linnsy-codex-session-'));
    const sessionsDir = join(codexHome, 'sessions', '2026', '05', '20');
    try {
      await mkdir(sessionsDir, { recursive: true });
      await writeFile(join(codexHome, 'session_index.jsonl'), [
        JSON.stringify({ id: 'linnsy-1', updated_at: '2026-05-20T12:00:00.000Z' }),
        JSON.stringify({ id: 'other-1', updated_at: '2026-05-20T11:00:00.000Z' }),
        JSON.stringify({ id: 'linnsy-2', updated_at: '2026-05-20T10:00:00.000Z' })
      ].join('\n'));
      await writeSessionMeta(sessionsDir, 'linnsy-1', '/Users/tiansi/code/linnsy');
      await writeSessionMeta(sessionsDir, 'other-1', '/Users/tiansi/code/other');
      await writeSessionMeta(sessionsDir, 'linnsy-2', '/Users/tiansi/code/linnsy');

      const bridge = createCodexSessionBridge({ codexHome });

      await expect(bridge.listProjects()).resolves.toEqual([{
        cwd: '/Users/tiansi/code/linnsy',
        label: 'linnsy',
        threadCount: 2,
        latestUpdatedAt: Date.parse('2026-05-20T12:00:00.000Z')
      }, {
        cwd: '/Users/tiansi/code/other',
        label: 'other',
        threadCount: 1,
        latestUpdatedAt: Date.parse('2026-05-20T11:00:00.000Z')
      }]);
    } finally {
      await rm(codexHome, { recursive: true, force: true });
    }
  });
});

async function writeSessionMeta(sessionsDir: string, id: string, cwd: string): Promise<void> {
  await writeFile(join(sessionsDir, `${id}.jsonl`), JSON.stringify({
    type: 'session_meta',
    payload: { id, cwd }
  }));
}

function sampleCodexTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    taskId: 'task_1',
    conversationId: 'conv_1',
    kind: 'external',
    attemptCount: 1,
    externalKind: 'codex',
    externalRef: '019e-session',
    locator: {
      kind: 'directory',
      label: 'linnsy',
      ref: '/Users/tiansi/code/linnsy'
    },
    title: '研究 Codex 可见接管',
    status: 'completed',
    workspacePath: '/tmp/task_1',
    createdAt: 1,
    updatedAt: 2,
    ...overrides
  };
}
