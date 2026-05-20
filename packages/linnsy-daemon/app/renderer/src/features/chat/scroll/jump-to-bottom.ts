import { useLayoutEffect, useRef } from 'react';

export interface JumpToBottomNoticeState {
  resetKey: string | null;
  baselineItemCount: number;
  pendingItemCount: number;
  wasStuckToBottom: boolean;
}

export interface JumpToBottomNoticeSnapshot {
  pendingItemCount: number;
}

export function createJumpToBottomNoticeState(
  resetKey: string | null,
  itemCount: number,
  stuckToBottom: boolean
): JumpToBottomNoticeState {
  return {
    resetKey,
    baselineItemCount: itemCount,
    pendingItemCount: 0,
    wasStuckToBottom: stuckToBottom
  };
}

export function deriveJumpToBottomNoticeState(
  previous: JumpToBottomNoticeState,
  resetKey: string | null,
  itemCount: number,
  stuckToBottom: boolean
): JumpToBottomNoticeState {
  if (previous.resetKey !== resetKey || stuckToBottom) {
    return createJumpToBottomNoticeState(resetKey, itemCount, stuckToBottom);
  }

  // 刚离开底部的这一帧只建立基线；之后新增的 conversation item 才计入提示。
  const baselineItemCount = previous.wasStuckToBottom ? itemCount : previous.baselineItemCount;
  return {
    resetKey,
    baselineItemCount,
    pendingItemCount: Math.max(0, itemCount - baselineItemCount),
    wasStuckToBottom: false
  };
}

export function useJumpToBottomNotice(options: {
  resetKey: string | null;
  itemCount: number;
  stuckToBottom: boolean;
}): JumpToBottomNoticeSnapshot {
  const stateRef = useRef<JumpToBottomNoticeState>(
    createJumpToBottomNoticeState(options.resetKey, options.itemCount, options.stuckToBottom)
  );
  const nextState = deriveJumpToBottomNoticeState(
    stateRef.current,
    options.resetKey,
    options.itemCount,
    options.stuckToBottom
  );

  useLayoutEffect(() => {
    stateRef.current = nextState;
  }, [nextState]);

  return {
    pendingItemCount: nextState.pendingItemCount
  };
}
