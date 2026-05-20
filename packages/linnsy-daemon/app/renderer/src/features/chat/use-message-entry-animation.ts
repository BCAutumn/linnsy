import { useLayoutEffect, useMemo, useRef } from 'react';

import type { ConversationItem } from './projection/types.js';
import {
  createInitialMessageEntryAnimationState,
  deriveMessageEntryAnimation,
  toMessageEntryAnimationEntries,
  type MessageEntryAnimationState
} from './message-entry-animation.js';

export function useMessageEntryAnimation(
  resetKey: string | null,
  items: readonly ConversationItem[]
): ReadonlySet<string> {
  const stateRef = useRef<MessageEntryAnimationState>(createInitialMessageEntryAnimationState());
  const entries = useMemo(() => toMessageEntryAnimationEntries(items), [items]);
  const result = useMemo(
    () => deriveMessageEntryAnimation(stateRef.current, resetKey, entries),
    [entries, resetKey]
  );

  useLayoutEffect(() => {
    stateRef.current = result.nextState;
  }, [result.nextState]);

  return result.animatedItemIds;
}
