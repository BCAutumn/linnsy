import { createUserMessage } from '@linnlabs/linnkit/contracts';
import { formatAgentLlmMessages } from '@linnlabs/linnkit/context-manager';
import { describe, expect, test } from 'vitest';

import {
  createLinnsyFenceRegistry,
  createLinnsySystemEventFence,
  createLinnsyTaskStatusChangeFence,
  createLinnsyTurnContextFence,
  LINNSY_FENCE_KINDS
} from '../fences.js';

describe('createLinnsyFenceRegistry', () => {
  test('registers the non-memory Linnsy fence families as user-role fences', () => {
    const registry = createLinnsyFenceRegistry();

    expect(registry.list().map((descriptor) => ({
      kind: descriptor.kind,
      llmRole: descriptor.llmRole,
      placement: descriptor.placement,
      lifetime: descriptor.lifetime
    }))).toEqual([
      {
        kind: LINNSY_FENCE_KINDS.userRequest,
        llmRole: 'user',
        placement: 'before-current-user',
        lifetime: 'persisted'
      },
      {
        kind: LINNSY_FENCE_KINDS.turnContext,
        llmRole: 'user',
        placement: 'before-current-user',
        lifetime: 'persisted'
      },
      {
        kind: LINNSY_FENCE_KINDS.systemEvent,
        llmRole: 'user',
        placement: 'before-current-user',
        lifetime: 'persisted'
      },
      {
        kind: LINNSY_FENCE_KINDS.subagentSummary,
        llmRole: 'user',
        placement: 'before-current-user',
        lifetime: 'persisted'
      },
      {
        kind: LINNSY_FENCE_KINDS.userInterjection,
        llmRole: 'user',
        placement: 'after-last-tool-result',
        lifetime: 'persisted'
      },
      {
        kind: LINNSY_FENCE_KINDS.memoryContext,
        llmRole: 'user',
        placement: 'before-current-user',
        lifetime: 'persisted'
      }
    ]);
  });

  test('formats owner requests as model-visible user_request fences', () => {
    const registry = createLinnsyFenceRegistry();
    const messages = [
      createUserMessage('context_injection', '帮我安排明早提醒', {
        fenceKind: LINNSY_FENCE_KINDS.userRequest,
        fenceAttrs: { source: 'owner-message' }
      })
    ];

    expect(formatAgentLlmMessages(messages, { fenceRegistry: registry })).toEqual([
      {
        role: 'user',
        content: '<user_request source="owner-message">\n帮我安排明早提醒\n</user_request>'
      }
    ]);
  });

  test('formats context injections through linnkit instead of prebuilt XML strings', () => {
    const registry = createLinnsyFenceRegistry();
    const messages = [
      createUserMessage('context_injection', 'drink water', {
        fenceKind: LINNSY_FENCE_KINDS.systemEvent,
        fenceAttrs: { kind: 'cron-fire', jobId: 'job_1' }
      })
    ];

    expect(formatAgentLlmMessages(messages, { fenceRegistry: registry })).toEqual([
      {
        role: 'user',
        content: '<system-event kind="cron-fire" jobId="job_1">\ndrink water\n</system-event>'
      }
    ]);
  });

  test('creates system-event injections without embedding fence markup in content', () => {
    const fence = createLinnsySystemEventFence('drink water', {
      kind: 'cron-fire',
      jobId: 'job_1'
    });

    expect(fence).toEqual({
      kind: LINNSY_FENCE_KINDS.systemEvent,
      content: 'drink water',
      attrs: {
        kind: 'cron-fire',
        jobId: 'job_1'
      }
    });
  });

  test('formats task terminal updates as system-event fences', () => {
    const registry = createLinnsyFenceRegistry();
    const fence = createLinnsyTaskStatusChangeFence({
      taskId: 'task_1',
      conversationId: 'conv_1',
      kind: 'external',
      attemptCount: 1,
      externalKind: 'codex',
      locator: { kind: 'directory', label: 'linnsy', ref: '/Users/tiansi/code/linnsy' },
      title: '修复测试',
      status: 'completed',
      result: { finalMessage: '完成第一步，要不要继续第二步' },
      createdAt: 1_000,
      updatedAt: 2_000
    });
    const messages = [
      createUserMessage('context_injection', fence.content, {
        fenceKind: fence.kind,
        fenceAttrs: fence.attrs
      })
    ];

    expect(formatAgentLlmMessages(messages, { fenceRegistry: registry })).toEqual([
      {
        role: 'user',
        content: [
          '<system-event kind="task_status_change" taskId="task_1" vendor="codex" status="completed" locator="linnsy(/Users/tiansi/code/linnsy)" finalMessage="完成第一步，要不要继续第二步">',
          '完成第一步，要不要继续第二步',
          '</system-event>'
        ].join('\n')
      }
    ]);
  });

  test('creates turn-context injections for per-turn volatile facts', () => {
    const fence = createLinnsyTurnContextFence('Current local time:\n- Local: 2026-04-29 Wednesday 12:00:00', {
      source: 'daemon',
      kind: 'current-time',
      generatedAt: 1_000
    });

    expect(fence).toEqual({
      kind: LINNSY_FENCE_KINDS.turnContext,
      content: 'Current local time:\n- Local: 2026-04-29 Wednesday 12:00:00',
      attrs: {
        source: 'daemon',
        kind: 'current-time',
        generatedAt: 1_000
      }
    });
  });
});
