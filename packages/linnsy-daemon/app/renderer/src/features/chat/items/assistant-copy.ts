import type { ConversationItem } from '../projection/types.js';

export function buildAssistantCopyTextByItemId(
  items: readonly ConversationItem[],
  settledRunIds: ReadonlySet<string>
): ReadonlyMap<string, string> {
  const draftsByRunId = new Map<string, AssistantCopyDraft>();

  for (const item of items) {
    if (item.kind !== 'assistant_bubble') {
      continue;
    }
    const previous = draftsByRunId.get(item.runId);
    const textSegments = previous === undefined
      ? []
      : [...previous.textSegments];
    if (item.text.trim().length > 0) {
      textSegments.push(item.text);
    }
    draftsByRunId.set(item.runId, {
      lastItemId: item.id,
      lastItemIsStreaming: item.streaming,
      textSegments
    });
  }

  const copyTextByItemId = new Map<string, string>();
  for (const [runId, draft] of draftsByRunId) {
    if (!settledRunIds.has(runId) || draft.lastItemIsStreaming || draft.textSegments.length === 0) {
      continue;
    }
    copyTextByItemId.set(draft.lastItemId, draft.textSegments.join('\n\n'));
  }
  return copyTextByItemId;
}

interface AssistantCopyDraft {
  lastItemId: string;
  lastItemIsStreaming: boolean;
  textSegments: readonly string[];
}
