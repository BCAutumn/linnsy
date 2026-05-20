import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  maybeWarnLargeConversation,
  resetLargeConversationWarningsForTest,
  type LargeConversationWarningDetail
} from '../chat-render-observer.js';

describe('chat render observer · S4.4', () => {
  afterEach(() => {
    resetLargeConversationWarningsForTest();
  });

  test('warns once when a development conversation crosses the large-list threshold', () => {
    const warn = vi.fn<(message: string, detail: LargeConversationWarningDetail) => void>();

    maybeWarnLargeConversation({
      conversationId: 'conv_large',
      enabled: true,
      itemCount: 301,
      warn
    });
    maybeWarnLargeConversation({
      conversationId: 'conv_large',
      enabled: true,
      itemCount: 450,
      warn
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[1]).toEqual({
      conversationId: 'conv_large',
      itemCount: 301,
      threshold: 300
    });
  });

  test('does not warn in production or below the threshold', () => {
    const warn = vi.fn<(message: string, detail: LargeConversationWarningDetail) => void>();

    maybeWarnLargeConversation({
      conversationId: 'conv_small',
      enabled: true,
      itemCount: 300,
      warn
    });
    maybeWarnLargeConversation({
      conversationId: 'conv_prod',
      enabled: false,
      itemCount: 999,
      warn
    });
    maybeWarnLargeConversation({
      conversationId: null,
      enabled: true,
      itemCount: 999,
      warn
    });

    expect(warn).not.toHaveBeenCalled();
  });

  test('tracks warnings per conversation', () => {
    const warn = vi.fn<(message: string, detail: LargeConversationWarningDetail) => void>();

    maybeWarnLargeConversation({
      conversationId: 'conv_a',
      enabled: true,
      itemCount: 301,
      threshold: 300,
      warn
    });
    maybeWarnLargeConversation({
      conversationId: 'conv_b',
      enabled: true,
      itemCount: 301,
      threshold: 300,
      warn
    });

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.map((call) => call[1].conversationId)).toEqual(['conv_a', 'conv_b']);
  });
});
