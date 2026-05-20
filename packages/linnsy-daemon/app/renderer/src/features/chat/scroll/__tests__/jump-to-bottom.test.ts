import { describe, expect, test } from 'vitest';

import {
  createJumpToBottomNoticeState,
  deriveJumpToBottomNoticeState
} from '../jump-to-bottom.js';

describe('jump to bottom notice', () => {
  test('keeps the notice quiet while the conversation is stuck to bottom', () => {
    const state = createJumpToBottomNoticeState('conv_1', 3, true);
    const next = deriveJumpToBottomNoticeState(state, 'conv_1', 5, true);

    expect(next.pendingItemCount).toBe(0);
    expect(next.baselineItemCount).toBe(5);
  });

  test('starts counting only after the user has left the bottom baseline', () => {
    const stuck = createJumpToBottomNoticeState('conv_1', 3, true);
    const leftBottom = deriveJumpToBottomNoticeState(stuck, 'conv_1', 3, false);
    const withNewItems = deriveJumpToBottomNoticeState(leftBottom, 'conv_1', 5, false);

    expect(leftBottom.pendingItemCount).toBe(0);
    expect(withNewItems.pendingItemCount).toBe(2);
  });

  test('resets the pending count after returning to the bottom', () => {
    const leftBottom = deriveJumpToBottomNoticeState(
      createJumpToBottomNoticeState('conv_1', 3, true),
      'conv_1',
      3,
      false
    );
    const withNewItems = deriveJumpToBottomNoticeState(leftBottom, 'conv_1', 5, false);
    const returned = deriveJumpToBottomNoticeState(withNewItems, 'conv_1', 5, true);

    expect(returned.pendingItemCount).toBe(0);
    expect(returned.baselineItemCount).toBe(5);
  });

  test('does not carry notice state across conversations', () => {
    const leftBottom = deriveJumpToBottomNoticeState(
      createJumpToBottomNoticeState('conv_1', 3, true),
      'conv_1',
      3,
      false
    );
    const switched = deriveJumpToBottomNoticeState(leftBottom, 'conv_2', 12, false);

    expect(switched.pendingItemCount).toBe(0);
    expect(switched.baselineItemCount).toBe(12);
  });
});
