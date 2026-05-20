import type { DeferredOutboundMessage } from './types.js';

export interface DeferredOutboundBatch {
  deferredIds: string[];
  text: string;
}

export interface DeferredMessageCoalescerOptions {
  minChunkChars: number;
  maxChunkChars: number;
}

const DEFAULT_SEPARATOR = '\n\n';

export function coalesceDeferredMessages(
  messages: DeferredOutboundMessage[],
  options: DeferredMessageCoalescerOptions
): DeferredOutboundBatch[] {
  const batches: DeferredOutboundBatch[] = [];
  let currentIds: string[] = [];
  let currentText = '';

  for (const message of messages) {
    const nextText = currentText.length === 0
      ? message.text
      : `${currentText}${DEFAULT_SEPARATOR}${message.text}`;
    const wouldExceedMax = currentText.length > 0 && nextText.length > options.maxChunkChars;
    const shouldFlushCurrent = wouldExceedMax || currentText.length >= options.minChunkChars;

    if (shouldFlushCurrent) {
      batches.push({
        deferredIds: currentIds,
        text: currentText
      });
      currentIds = [message.deferredId];
      currentText = message.text;
      continue;
    }

    currentIds.push(message.deferredId);
    currentText = nextText;
  }

  if (currentIds.length > 0) {
    batches.push({
      deferredIds: currentIds,
      text: currentText
    });
  }

  return batches;
}
