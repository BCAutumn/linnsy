import { describe, expect, test } from 'vitest';

import type { AssistantBubbleItem, ToolCallCardItem } from '../../projection/types.js';
import { buildAssistantCopyTextByItemId } from '../assistant-copy.js';

describe('assistant copy text', () => {
  test('only the last settled assistant segment in one run gets the whole run answer', () => {
    const copyTextByItemId = buildAssistantCopyTextByItemId(
      [
        assistantItem({ id: 'answer_1', answerId: 'a1', text: '我先查一下' }),
        toolItem(),
        assistantItem({ id: 'answer_2', answerId: 'a2', text: '查完了，结论是 B' })
      ],
      new Set(['run_1'])
    );

    expect(copyTextByItemId.has('answer_1')).toBe(false);
    expect(copyTextByItemId.get('answer_2')).toBe('我先查一下\n\n查完了，结论是 B');
  });

  test('does not expose copy while the last segment is still streaming', () => {
    const copyTextByItemId = buildAssistantCopyTextByItemId(
      [
        assistantItem({ id: 'answer_1', answerId: 'a1', text: '我先查一下' }),
        assistantItem({ id: 'answer_2', answerId: 'a2', text: '正在写', streaming: true })
      ],
      new Set(['run_1'])
    );

    expect(copyTextByItemId.size).toBe(0);
  });

  test('does not expose copy before the run is settled even if the current answer stopped for a tool call', () => {
    const copyTextByItemId = buildAssistantCopyTextByItemId(
      [
        assistantItem({ id: 'answer_1', answerId: 'a1', text: '我先查一下' }),
        toolItem()
      ],
      new Set()
    );

    expect(copyTextByItemId.size).toBe(0);
  });
});

function assistantItem(input: {
  id: string;
  answerId: string;
  text: string;
  streaming?: boolean;
}): AssistantBubbleItem {
  return {
    kind: 'assistant_bubble',
    id: input.id,
    conversationId: 'c1',
    createdAt: 1,
    text: input.text,
    streaming: input.streaming ?? false,
    messageId: input.id,
    runId: 'run_1',
    answerId: input.answerId,
    chunks: new Map(),
    thoughtChunks: []
  };
}

function toolItem(): ToolCallCardItem {
  return {
    kind: 'tool_call_card',
    id: 'tool_1',
    conversationId: 'c1',
    createdAt: 2,
    toolCallId: 'tc_1',
    toolName: 'lookup',
    status: 'success',
    args: {},
    startedAt: 2,
    endedAt: 3,
    runId: 'run_1'
  };
}
