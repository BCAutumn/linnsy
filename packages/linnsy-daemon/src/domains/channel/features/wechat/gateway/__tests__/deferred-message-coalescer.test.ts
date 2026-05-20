import { describe, expect, test } from 'vitest';

import { coalesceDeferredMessages } from '../deferred-message-coalescer.js';

describe('coalesceDeferredMessages', () => {
  test('merges consecutive short deferred messages into one outbound chunk', () => {
    const result = coalesceDeferredMessages([
      {
        deferredId: 'deferred_1',
        chatId: 'wx_user_1',
        text: 'first short update',
        deliveryMode: 'proactive',
        createdAt: 1_000
      },
      {
        deferredId: 'deferred_2',
        chatId: 'wx_user_1',
        text: 'second short update',
        deliveryMode: 'proactive',
        createdAt: 2_000
      }
    ], {
      minChunkChars: 40,
      maxChunkChars: 500
    });

    expect(result).toEqual([
      {
        deferredIds: ['deferred_1', 'deferred_2'],
        text: 'first short update\n\nsecond short update'
      }
    ]);
  });

  test('keeps long deferred messages separate once the chunk is already large enough', () => {
    const result = coalesceDeferredMessages([
      {
        deferredId: 'deferred_1',
        chatId: 'wx_user_1',
        text: 'a'.repeat(80),
        deliveryMode: 'proactive',
        createdAt: 1_000
      },
      {
        deferredId: 'deferred_2',
        chatId: 'wx_user_1',
        text: 'b'.repeat(80),
        deliveryMode: 'proactive',
        createdAt: 2_000
      }
    ], {
      minChunkChars: 40,
      maxChunkChars: 500
    });

    expect(result).toEqual([
      {
        deferredIds: ['deferred_1'],
        text: 'a'.repeat(80)
      },
      {
        deferredIds: ['deferred_2'],
        text: 'b'.repeat(80)
      }
    ]);
  });

  test('splits before exceeding the max chunk size', () => {
    const result = coalesceDeferredMessages([
      {
        deferredId: 'deferred_1',
        chatId: 'wx_user_1',
        text: 'a'.repeat(30),
        deliveryMode: 'proactive',
        createdAt: 1_000
      },
      {
        deferredId: 'deferred_2',
        chatId: 'wx_user_1',
        text: 'b'.repeat(30),
        deliveryMode: 'proactive',
        createdAt: 2_000
      }
    ], {
      minChunkChars: 200,
      maxChunkChars: 50
    });

    expect(result).toEqual([
      {
        deferredIds: ['deferred_1'],
        text: 'a'.repeat(30)
      },
      {
        deferredIds: ['deferred_2'],
        text: 'b'.repeat(30)
      }
    ]);
  });
});
