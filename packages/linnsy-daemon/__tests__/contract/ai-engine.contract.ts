import { describe, expect, test } from 'vitest';
import { createUserMessage } from '@linnlabs/linnkit/contracts';
import type { AgentAiEngine, AgentAiEngineStreamContent } from '@linnlabs/linnkit/ports';

import { createMockAiEngine } from '../../src/domains/llm/features/provider-routing/codecs/mock.js';

describe('LinnsyAiEngineBridge mock contract', () => {
  test('implements non-streaming AgentAiEngine response shape', async () => {
    const engine: AgentAiEngine = createMockAiEngine({
      content: '收到，老板'
    });

    const result = await engine.chatCompletion('mock.secretary', [
      createUserMessage('user_input', '帮我记录一下')
    ]);

    expect(result).toEqual({
      content: '收到，老板'
    });
  });

  test('implements streaming AgentAiEngine callback shape', async () => {
    const engine: AgentAiEngine = createMockAiEngine({
      content: '收到',
      thought: '需要简短确认',
      usage: { tokens: 12 }
    });
    const chunks: AgentAiEngineStreamContent[] = [];
    const thoughts: string[] = [];
    const usages: unknown[] = [];
    const finishes: string[] = [];

    await engine.chatCompletionStream(
      'mock.secretary',
      [createUserMessage('user_input', '提醒我喝水')],
      undefined,
      (content) => chunks.push(content),
      undefined,
      (reason) => finishes.push(reason),
      (thought) => thoughts.push(thought),
      (usage) => usages.push(usage)
    );

    expect(chunks).toEqual(['收到']);
    expect(thoughts).toEqual(['需要简短确认']);
    expect(usages).toEqual([{ tokens: 12 }]);
    expect(finishes).toEqual(['stop']);
  });
});
