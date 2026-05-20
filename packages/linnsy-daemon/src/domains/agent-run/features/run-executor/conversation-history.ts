import {
  createAssistantMessage,
  createSystemMessage,
  createUserMessage,
  type AiMessage
} from '@linnlabs/linnkit/contracts';

import type { MessageRecord } from '../../../../persistence/stores/message/message-store-port.js';
import { isRecord } from '../../../../shared/json.js';
import { LINNSY_FENCE_KINDS } from '../context-engineering/fences.js';
import type { RunWakeSource } from '../run-spawner/types.js';
import type { RunExecutorFoundationDeps } from './types.js';

export async function buildConversationHistory(input: {
  foundation: RunExecutorFoundationDeps;
  conversationId: string;
  systemPrompt: string;
  query: string;
  limit?: number;
  skipStoredMessages?: boolean;
  includeCurrentUserRequest: boolean;
}): Promise<AiMessage[]> {
  const history: AiMessage[] = [createSystemMessage('system_prompt', input.systemPrompt)];
  if (input.skipStoredMessages !== true) {
    // 模型上下文需要最近发生的事；拿到最近窗口后仍按时间正序交给 linnkit 做预算裁剪。
    const records = await input.foundation.messages.listRecentByConversation(input.conversationId, {
      ...(input.limit === undefined ? {} : { limit: input.limit })
    });
    for (const record of records) {
      const message = toAiMessage(record);
      if (message !== undefined) {
        history.push(message);
      }
    }
  }
  const last = history.at(-1);
  if (
    input.includeCurrentUserRequest &&
    (!isAiMessageWithContent(last) || last.role !== 'user' || last.content !== input.query)
  ) {
    history.push(createUserRequestMessage(input.query));
  }
  return history;
}

export function shouldAppendCurrentUserRequest(wakeSource: RunWakeSource | undefined): boolean {
  return wakeSource === undefined || wakeSource === 'owner-message';
}

export function createUserRequestMessage(content: string): AiMessage {
  return createUserMessage('context_injection', content, {
    fenceKind: LINNSY_FENCE_KINDS.userRequest,
    fenceAttrs: { source: 'owner-message' }
  });
}

function toAiMessage(record: MessageRecord): AiMessage | undefined {
  if (record.text === undefined || record.text.length === 0) {
    return undefined;
  }
  if (record.metadata?.fenceKind !== undefined) {
    if (typeof record.metadata.fenceKind !== 'string') {
      return undefined;
    }
    return createUserMessage('context_injection', record.text, record.metadata);
  }
  if (record.role === 'user') {
    return createUserRequestMessage(record.text);
  }
  if (record.role === 'assistant') {
    return createAssistantMessage('final_answer', record.text);
  }
  if (record.role === 'system') {
    return createSystemMessage('system_prompt', record.text);
  }
  return undefined;
}

function isAiMessageWithContent(message: AiMessage | undefined): message is AiMessage & { content: string; role: string } {
  return isRecord(message) && typeof message.content === 'string' && typeof message.role === 'string';
}
