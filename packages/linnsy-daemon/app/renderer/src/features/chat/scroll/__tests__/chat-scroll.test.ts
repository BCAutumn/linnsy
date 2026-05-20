import { describe, expect, test } from 'vitest';

import { buildChatScrollWatchKey } from '../chat-scroll.js';
import { distanceToBottom, isNearBottom } from '../use-sticky-scroll.js';
import type { ConversationItem } from '../../projection/types.js';

describe('chat sticky scroll helpers', () => {
  test('treats the viewport as stuck when it is close enough to the bottom', () => {
    expect(distanceToBottom({
      scrollTop: 760,
      scrollHeight: 1000,
      clientHeight: 220
    })).toBe(20);
    expect(isNearBottom({
      scrollTop: 760,
      scrollHeight: 1000,
      clientHeight: 220
    }, 24)).toBe(true);
    expect(isNearBottom({
      scrollTop: 720,
      scrollHeight: 1000,
      clientHeight: 220
    }, 24)).toBe(false);
  });

  test('changes the watch key when streaming text grows', () => {
    const baseItem: ConversationItem = {
      kind: 'assistant_bubble',
      id: 'stream:run_1:ans_1',
      conversationId: 'conv_test',
      createdAt: 1,
      text: '你',
      streaming: true,
      messageId: 'stream:run_1:ans_1',
      runId: 'run_1',
      answerId: 'ans_1',
      chunks: new Map([[0, '你']]),
      thoughtChunks: []
    };
    const before = buildChatScrollWatchKey([baseItem]);
    const after = buildChatScrollWatchKey([{ ...baseItem, text: '你好' }]);

    expect(before).not.toBe(after);
  });

  test('changes the watch key when an item finalizes (streaming → settled)', () => {
    const streaming: ConversationItem = {
      kind: 'assistant_bubble',
      id: 'stream:run_1:ans_1',
      conversationId: 'conv_test',
      createdAt: 1,
      text: '你好',
      streaming: true,
      messageId: 'stream:run_1:ans_1',
      runId: 'run_1',
      answerId: 'ans_1',
      chunks: new Map([[0, '你好']]),
      thoughtChunks: []
    };
    const settled: ConversationItem = {
      ...streaming,
      id: 'msg_1',
      messageId: 'msg_1',
      streaming: false
    };
    expect(buildChatScrollWatchKey([streaming])).not.toBe(buildChatScrollWatchKey([settled]));
  });
});
