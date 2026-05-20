import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';

import {
  createLinnkitGraphRunExecutor,
  createLinnsyMainAgentDefinition,
  createLinnsyRuntimeFoundation,
  createLinnsySystemEventFence,
  createReplyRouter,
  createSystemPromptAssembler,
  createTempLinnsyHome,
  minimalConfig,
  rm
} from './scenarios/linnkit-graph-executor-support.js';
import type { AiMessage } from './scenarios/linnkit-graph-executor-support.js';
import { LINNSY_FENCE_KINDS } from '../../context-engineering/fences.js';

describe('createLinnkitGraphRunExecutor context assembly', () => {
  test('runs the public linnkit graph executor and returns the final answer', async () => {
    const home = await createTempLinnsyHome();
    const foundation = createLinnsyRuntimeFoundation(minimalConfig(home), {
      providerRouter: createReplyRouter('real-llm-reply')
    });

    try {
      await foundation.conversations.upsert({
        conversationId: 'conv_1',
        sessionKey: 'linnsy:main:cli:private:local',
        platform: 'cli',
        chatType: 'private',
        chatId: 'local',
        createdAt: 1,
        updatedAt: 1
      });
      await foundation.messages.insert({
        messageId: 'in_1',
        conversationId: 'conv_1',
        role: 'user',
        source: 'inbound',
        platform: 'cli',
        text: 'hi',
        createdAt: 2
      });

      const executor = createLinnkitGraphRunExecutor({
        foundation,
        systemPromptAssembler: createSystemPromptAssembler({ clock: { now: () => 3 } })
      });
      const outcome = await executor.execute({
        runId: 'run_1',
        conversationId: 'conv_1',
        definition: createLinnsyMainAgentDefinition(),
        query: 'hi',
        signal: new AbortController().signal
      });

      expect(outcome).toMatchObject({
        status: 'completed',
        finalAnswer: 'real-llm-reply'
      });
      expect(outcome.iterationsUsed).toBeGreaterThan(0);
      await expect(foundation.checkpointer.load('conv_1')).resolves.toMatchObject({
        local: {
          executorLocal: {
            maxSteps: 40
          }
        }
      });
      const decisionAudit = readJsonlObjects(await readFile(foundation.auditLogPath, 'utf8'));
      expect(decisionAudit.some((record) => {
        return record.action === 'model.select' &&
          readNestedString(record, ['scope', 'runId']) === 'run_1' &&
          readNestedString(record, ['decision', 'metadata', 'selectedModelId']) === 'openai.gpt5';
      })).toBe(true);

      const runContextAudit = readJsonlObjects(await readFile(foundation.runContextAuditLogPath, 'utf8'));
      const runContextRecord = runContextAudit.find((record) => record.runId === 'run_1');
      expect(runContextRecord).toMatchObject({
        kind: 'run_context',
        status: 'completed',
        runId: 'run_1',
        conversationId: 'conv_1',
        snapshotCount: 1
      });
      expect(readArrayLength(runContextRecord, 'uniqueMessages')).toBeGreaterThan(0);
      expect(readArrayLength(readFirstSnapshot(runContextRecord), 'messageRefs')).toBeGreaterThan(0);
    } finally {
      foundation.dispose();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('skips ordinary conversation history for ephemeral cron runs', async () => {
    const home = await createTempLinnsyHome();
    const capturedMessages: AiMessage[][] = [];
    const foundation = createLinnsyRuntimeFoundation(minimalConfig(home), {
      providerRouter: createReplyRouter('cron reply', capturedMessages)
    });

    try {
      await foundation.conversations.upsert({
        conversationId: 'conv_1',
        sessionKey: 'linnsy:main:cli:private:local',
        platform: 'cli',
        chatType: 'private',
        chatId: 'local',
        createdAt: 1,
        updatedAt: 1
      });
      await foundation.messages.insert({
        messageId: 'old_user',
        conversationId: 'conv_1',
        role: 'user',
        source: 'inbound',
        platform: 'cli',
        text: 'old preference',
        createdAt: 2
      });
      await foundation.messages.insert({
        messageId: 'old_assistant',
        conversationId: 'conv_1',
        role: 'assistant',
        source: 'outbound',
        platform: 'cli',
        text: 'old answer',
        createdAt: 3
      });

      const executor = createLinnkitGraphRunExecutor({
        foundation,
        systemPromptAssembler: createSystemPromptAssembler({ clock: { now: () => 4 } })
      });
      await executor.execute({
        runId: 'run_cron_1',
        conversationId: 'conv_1',
        definition: createLinnsyMainAgentDefinition(),
        query: 'drink water',
        signal: new AbortController().signal,
        ephemeral: { skipMemory: true, skipContextFiles: true }
      });

      const messages = capturedMessages.at(-1);
      expect(messages?.map((message) => [message.role, message.type, message.content])).toEqual([
        ['system', 'system_prompt', expect.any(String)],
        ['user', 'context_injection', expect.stringContaining('Current local time:')],
        ['user', 'context_injection', 'drink water']
      ]);
      const userRequestMessage = messages?.find((message) => {
        return message.role === 'user' &&
          message.type === 'context_injection' &&
          message.metadata?.fenceKind === LINNSY_FENCE_KINDS.userRequest;
      });
      expect(userRequestMessage?.metadata?.fenceAttrs).toEqual({ source: 'owner-message' });
      expect(messages?.some((message) => message.type === 'user_input')).toBe(false);
    } finally {
      foundation.dispose();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('feeds linnkit the recent conversation window instead of the oldest messages', async () => {
    const home = await createTempLinnsyHome();
    const capturedMessages: AiMessage[][] = [];
    const foundation = createLinnsyRuntimeFoundation(minimalConfig(home), {
      providerRouter: createReplyRouter('recent reply', capturedMessages)
    });

    try {
      await foundation.conversations.upsert({
        conversationId: 'conv_recent',
        sessionKey: 'linnsy:main:cli:private:recent',
        platform: 'cli',
        chatType: 'private',
        chatId: 'recent',
        createdAt: 1,
        updatedAt: 1
      });
      for (let index = 1; index <= 6; index += 1) {
        await foundation.messages.insert({
          messageId: `msg_${String(index)}`,
          conversationId: 'conv_recent',
          role: index % 2 === 0 ? 'assistant' : 'user',
          source: index % 2 === 0 ? 'outbound' : 'inbound',
          platform: 'cli',
          text: `history-${String(index)}`,
          createdAt: index + 1
        });
      }

      const executor = createLinnkitGraphRunExecutor({
        foundation,
        systemPromptAssembler: createSystemPromptAssembler({ clock: { now: () => 10 } }),
        historyLimit: 4
      });
      await executor.execute({
        runId: 'run_recent_1',
        conversationId: 'conv_recent',
        definition: createLinnsyMainAgentDefinition(),
        query: 'current request',
        signal: new AbortController().signal
      });

      const visibleContent = capturedMessages.at(-1)?.map((message) => message.content).join('\n') ?? '';
      expect(visibleContent).not.toContain('history-1');
      expect(visibleContent).not.toContain('history-2');
      expect(visibleContent).toContain('history-3');
      expect(visibleContent).toContain('history-6');
      expect(visibleContent).toContain('current request');
    } finally {
      foundation.dispose();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('injects system-event fences without mutating the system prompt', async () => {
    const home = await createTempLinnsyHome();
    const capturedMessages: AiMessage[][] = [];
    const foundation = createLinnsyRuntimeFoundation(minimalConfig(home), {
      providerRouter: createReplyRouter('cron reply', capturedMessages)
    });

    try {
      await foundation.conversations.upsert({
        conversationId: 'conv_event',
        sessionKey: 'linnsy:main:cli:private:event',
        platform: 'cli',
        chatType: 'private',
        chatId: 'event',
        createdAt: 1,
        updatedAt: 1
      });

      const executor = createLinnkitGraphRunExecutor({
        foundation,
        systemPromptAssembler: createSystemPromptAssembler({ clock: { now: () => 4 } })
      });
      await executor.execute({
        runId: 'run_event_1',
        conversationId: 'conv_event',
        definition: createLinnsyMainAgentDefinition(),
        query: 'drink water',
        signal: new AbortController().signal,
        contextFences: [
          createLinnsySystemEventFence('drink water', {
            kind: 'cron-fire',
            jobId: 'job_1'
          })
        ],
        wakeSource: 'system-event',
        ephemeral: { skipMemory: true, skipContextFiles: true }
      });

      const messages = capturedMessages.at(-1);
      expect(messages?.[0]?.role).toBe('system');
      expect(String(messages?.[0]?.content)).not.toContain('<system-event');
      expect(messages?.some((message) => {
        return message.role === 'user' &&
          message.type === 'context_injection' &&
          message.content === 'drink water' &&
          message.metadata?.fenceKind === 'system-event';
      })).toBe(true);
      // 系统事件唤醒不是主人发消息，不能再额外伪造一条 user_input。
      expect(messages?.some((message) => {
        return message.role === 'user' &&
          message.type === 'user_input' &&
          message.content === 'drink water';
      })).toBe(false);
    } finally {
      foundation.dispose();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('injects real memory into system prompt and memory-context fences for main agent turns', async () => {
    const home = await createTempLinnsyHome();
    const capturedMessages: AiMessage[][] = [];
    const foundation = createLinnsyRuntimeFoundation(minimalConfig(home), {
      providerRouter: createReplyRouter('memory reply', capturedMessages),
      clock: { now: () => 1_777_437_600_000 }
    });

    try {
      await foundation.conversations.upsert({
        conversationId: 'conv_memory',
        sessionKey: 'linnsy:main:cli:private:memory',
        platform: 'cli',
        chatType: 'private',
        chatId: 'memory',
        createdAt: 1,
        updatedAt: 1
      });
      await foundation.memoryStore.upsert({
        scope: 'system_prompt',
        body: '所有回答都要先判断主人真正想完成什么。'
      });
      await foundation.memoryStore.upsert({
        scope: 'persona',
        body: 'Linnsy 是可靠、主动、但不过度打扰的个人秘书。'
      });
      await foundation.memoryStore.upsert({
        scope: 'work_style',
        body: '先理解主人真正想完成什么，再选择是否行动。'
      });
      await foundation.memoryStore.upsert({
        scope: 'user_preference',
        body: '主人希望被称呼为天司。'
      });
      await foundation.memoryStore.upsert({
        scope: 'long_term_memory',
        body: 'Linnsy 项目需要真实记忆上下文。'
      });
      const recalledBeforeRun = await foundation.memoryStore.recall({
        query: '天司，记忆上下文怎么样了',
        limit: 8
      });
      expect(recalledBeforeRun.some((item) => item.body.includes('真实记忆上下文'))).toBe(true);

      const executor = createLinnkitGraphRunExecutor({
        foundation,
        systemPromptAssembler: createSystemPromptAssembler({ clock: { now: () => 4 } })
      });
      await executor.execute({
        runId: 'run_memory_1',
        conversationId: 'conv_memory',
        definition: createLinnsyMainAgentDefinition(),
        query: '天司，记忆上下文怎么样了',
        signal: new AbortController().signal
      });

      const messages = capturedMessages.at(-1);
      expect(String(messages?.[0]?.content)).toContain('所有回答都要先判断主人真正想完成什么。');
      expect(String(messages?.[0]?.content)).not.toContain('You are Linnsy, the owner');
      expect(String(messages?.[0]?.content)).toContain('[linnsy_persona]');
      expect(String(messages?.[0]?.content)).toContain('可靠、主动、但不过度打扰');
      expect(String(messages?.[0]?.content)).toContain('[work_style]');
      expect(String(messages?.[0]?.content)).toContain('[user_preference]');
      expect(String(messages?.[0]?.content)).toContain('[long_term_memory]');
      expect(String(messages?.[0]?.content)).toContain('主人希望被称呼为天司。');
      expect(String(messages?.[0]?.content)).toContain('Linnsy 项目需要真实记忆上下文。');
      const turnContextMessage = messages?.find((message) => {
        return message.role === 'user' &&
          message.type === 'context_injection' &&
          typeof message.content === 'string' &&
          message.metadata?.fenceKind === 'turn-context';
      });
      expect(turnContextMessage).toBeDefined();
      expect(String(turnContextMessage?.content)).toContain('Current local time:');
      expect(String(turnContextMessage?.content)).toContain('2026-04-29 Wednesday');
      expect(String(turnContextMessage?.content)).not.toContain('ISO:');
      const memoryContextMessage = messages?.find((message) => {
        return message.role === 'user' &&
          message.type === 'context_injection' &&
          typeof message.content === 'string' &&
          message.metadata?.fenceKind === 'memory-context';
      });
      expect(memoryContextMessage).toBeDefined();
      expect(String(memoryContextMessage?.content)).toContain('真实记忆上下文');
    } finally {
      foundation.dispose();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('does not inject disabled user preferences or long-term memory into the system role', async () => {
    const home = await createTempLinnsyHome();
    const capturedMessages: AiMessage[][] = [];
    const foundation = createLinnsyRuntimeFoundation(minimalConfig(home), {
      providerRouter: createReplyRouter('disabled memory reply', capturedMessages)
    });

    try {
      await foundation.conversations.upsert({
        conversationId: 'conv_disabled_memory',
        sessionKey: 'linnsy:main:cli:private:disabled-memory',
        platform: 'cli',
        chatType: 'private',
        chatId: 'disabled-memory',
        createdAt: 1,
        updatedAt: 1
      });
      await foundation.memoryStore.upsert({
        scope: 'user_preference',
        body: '这段用户偏好不应该进入 system。',
        metadata: { enabled: false }
      });
      await foundation.memoryStore.upsert({
        scope: 'long_term_memory',
        body: '这段长期记忆不应该进入 system。',
        metadata: { enabled: false }
      });

      const executor = createLinnkitGraphRunExecutor({
        foundation,
        systemPromptAssembler: createSystemPromptAssembler({ clock: { now: () => 4 } })
      });
      await executor.execute({
        runId: 'run_disabled_memory_1',
        conversationId: 'conv_disabled_memory',
        definition: createLinnsyMainAgentDefinition(),
        query: '看看关闭的记忆',
        signal: new AbortController().signal
      });

      const systemContent = String(capturedMessages.at(-1)?.[0]?.content);
      expect(systemContent).not.toContain('[user_preference]');
      expect(systemContent).not.toContain('[long_term_memory]');
      expect(systemContent).not.toContain('这段用户偏好不应该进入 system。');
      expect(systemContent).not.toContain('这段长期记忆不应该进入 system。');
    } finally {
      foundation.dispose();
      await rm(home, { recursive: true, force: true });
    }
  });

});

function readJsonlObjects(content: string): Array<Record<string, unknown>> {
  return content
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const parsed = JSON.parse(line) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('expected JSON object line');
      }
      return parsed as Record<string, unknown>;
    });
}

function readNestedString(record: Record<string, unknown>, keys: string[]): string | undefined {
  let current: unknown = record;
  for (const key of keys) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' ? current : undefined;
}

function readArrayLength(record: Record<string, unknown> | undefined, key: string): number {
  const value = record?.[key];
  if (!Array.isArray(value)) {
    return 0;
  }
  return value.length;
}

function readFirstSnapshot(record: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const snapshots = record?.snapshots;
  if (!Array.isArray(snapshots)) {
    return undefined;
  }
  const first: unknown = snapshots[0];
  if (typeof first !== 'object' || first === null || Array.isArray(first)) {
    return undefined;
  }
  return first as Record<string, unknown>;
}
