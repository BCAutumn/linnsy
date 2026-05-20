import { describe, expect, test } from 'vitest';

import {
  createCodexDelegationThenAnswerRouter,
  createDelegateToExternalTool,
  createLinnkitGraphRunExecutor,
  createLinnsyAgentRegistry,
  createLinnsyMainAgentDefinition,
  createLinnsyRuntimeFoundation,
  createLinnsyToolRuntime,
  createSingleToolRuntime,
  createSystemPromptAssembler,
  createTempLinnsyHome,
  createToolThenAnswerRouter,
  createWorkspaceManager,
  join,
  minimalConfig,
  mkdir,
  rm
} from './scenarios/linnkit-graph-executor-support.js';
import type { AiMessage, ExternalAgentDispatcherPort, ExternalAgentDispatchInput } from './scenarios/linnkit-graph-executor-support.js';

describe('createLinnkitGraphRunExecutor tool execution', () => {
  test('replays in-run tool outputs into the next LLM call', async () => {
    const home = await createTempLinnsyHome();
    const capturedMessages: AiMessage[][] = [];
    const foundation = createLinnsyRuntimeFoundation(minimalConfig(home), {
      providerRouter: createToolThenAnswerRouter(capturedMessages)
    });

    try {
      await foundation.conversations.upsert({
        conversationId: 'conv_tool_replay',
        sessionKey: 'linnsy:main:cli:private:tool-replay',
        platform: 'cli',
        chatType: 'private',
        chatId: 'tool-replay',
        createdAt: 1,
        updatedAt: 1
      });
      await foundation.messages.insert({
        messageId: 'in_tool_replay',
        conversationId: 'conv_tool_replay',
        role: 'user',
        source: 'inbound',
        platform: 'cli',
        text: 'show tasks',
        createdAt: 2
      });

      const executor = createLinnkitGraphRunExecutor({
        foundation,
        systemPromptAssembler: createSystemPromptAssembler({ clock: { now: () => 3 } }),
        toolRuntime: createSingleToolRuntime()
      });
      const outcome = await executor.execute({
        runId: 'run_tool_replay',
        conversationId: 'conv_tool_replay',
        definition: createLinnsyMainAgentDefinition({
          toolPolicy: { allowedToolIds: ['list_tasks'] }
        }),
        query: 'show tasks',
        signal: new AbortController().signal
      });

      expect(outcome.finalAnswer).toBe('saw tool result');
      expect(capturedMessages).toHaveLength(2);
      const secondCallMessages = capturedMessages[1] ?? [];
      expect(secondCallMessages.some((message) => {
        return message.role === 'tool' &&
          message.metadata?.tool_call_id === 'call_list_tasks' &&
          typeof message.content === 'string' &&
          message.content.includes('task_alpha');
      })).toBe(true);
      const userRequestIndex = secondCallMessages.findIndex((message) => {
        return message.role === 'user' &&
          message.type === 'context_injection' &&
          message.metadata?.fenceKind === 'user-request' &&
          message.content === 'show tasks';
      });
      const turnContextIndex = secondCallMessages.findIndex((message) => {
        return message.role === 'user' &&
          message.type === 'context_injection' &&
          message.metadata?.fenceKind === 'turn-context';
      });
      const toolResultIndex = secondCallMessages.findIndex((message) => {
        return message.role === 'tool' &&
          message.metadata?.tool_call_id === 'call_list_tasks';
      });
      expect(userRequestIndex).toBeGreaterThan(-1);
      expect(turnContextIndex).toBeGreaterThan(-1);
      expect(toolResultIndex).toBeGreaterThan(-1);
      expect(turnContextIndex).toBeLessThan(toolResultIndex);
      expect(userRequestIndex).toBeLessThan(toolResultIndex);
    } finally {
      foundation.dispose();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('lets the main conversation delegate a codex task through delegate_to_external', async () => {
    const home = await createTempLinnsyHome();
    const capturedMessages: AiMessage[][] = [];
    const projectPath = join(home, 'project-under-test');
    const workspaceRoot = join(home, 'workspaces');
    const dispatches: ExternalAgentDispatchInput[] = [];
    const dispatcher: ExternalAgentDispatcherPort = {
      dispatch(input) {
        dispatches.push({
          taskId: input.taskId,
          definitionKey: input.definitionKey,
          locator: input.locator,
          workspacePath: input.workspacePath,
          ...(input.payload === undefined ? {} : { payload: input.payload })
        });
        return Promise.resolve();
      },
      continue: () => Promise.resolve(),
      cancel: () => Promise.resolve()
    };
    const foundation = createLinnsyRuntimeFoundation(minimalConfig(home), {
      providerRouter: createCodexDelegationThenAnswerRouter({
        capturedMessages,
        cwd: projectPath,
        prompt: 'Edit smoke.txt and report the changed file.'
      })
    });

    try {
      await mkdir(projectPath, { recursive: true });
      await foundation.conversations.upsert({
        conversationId: 'conv_codex_delegate',
        sessionKey: 'linnsy:main:cli:private:codex-delegate',
        platform: 'cli',
        chatType: 'private',
        chatId: 'codex-delegate',
        createdAt: 1,
        updatedAt: 1
      });
      await foundation.messages.insert({
        messageId: 'in_codex_delegate',
        conversationId: 'conv_codex_delegate',
        role: 'user',
        source: 'inbound',
        platform: 'cli',
        text: `让 Codex 修改 ${projectPath} 里的 smoke.txt`,
        createdAt: 2
      });

      const toolRuntime = createLinnsyToolRuntime({
        tools: [
          createDelegateToExternalTool({
            registry: createLinnsyAgentRegistry(),
            taskTracker: foundation.taskTracker,
            workspace: createWorkspaceManager({ root: workspaceRoot }),
            dispatcher,
            taskIdFactory: () => 'task_codex_main'
          })
        ]
      });
      const executor = createLinnkitGraphRunExecutor({
        foundation,
        systemPromptAssembler: createSystemPromptAssembler({ clock: { now: () => 3 } }),
        toolRuntime
      });
      const outcome = await executor.execute({
        runId: 'run_codex_delegate',
        conversationId: 'conv_codex_delegate',
        definition: createLinnsyMainAgentDefinition({
          toolPolicy: { allowedToolIds: ['delegate_to_external'] }
        }),
        query: `让 Codex 修改 ${projectPath} 里的 smoke.txt`,
        signal: new AbortController().signal
      });

      expect(outcome.finalAnswer).toBe('Codex task dispatched.');
      await expect(foundation.checkpointer.load('conv_codex_delegate')).resolves.toMatchObject({
        local: {
          executorLocal: {
            maxSteps: 40
          }
        }
      });
      expect(dispatches).toEqual([{
        taskId: 'task_codex_main',
        definitionKey: 'delegate_to_codex',
        locator: {
          kind: 'directory',
          label: 'project-under-test',
          ref: projectPath
        },
        workspacePath: join(workspaceRoot, 'task_codex_main'),
        payload: {
          prompt: 'Edit smoke.txt and report the changed file.'
        }
      }]);
      await expect(foundation.taskTracker.get('task_codex_main')).resolves.toMatchObject({
        conversationId: 'conv_codex_delegate',
        originRunId: 'run_codex_delegate',
        status: 'dispatched',
        externalKind: 'codex',
        locator: {
          kind: 'directory',
          label: 'project-under-test',
          ref: projectPath
        },
        payload: {
          definitionKey: 'delegate_to_codex',
          prompt: 'Edit smoke.txt and report the changed file.'
        }
      });
      const secondCallMessages = capturedMessages[1] ?? [];
      expect(secondCallMessages.some((message) => {
        return message.role === 'tool' &&
          message.metadata?.tool_call_id === 'call_delegate_codex' &&
          typeof message.content === 'string' &&
          message.content.includes('task_codex_main');
      })).toBe(true);
    } finally {
      foundation.dispose();
      await rm(home, { recursive: true, force: true });
    }
  });

});
