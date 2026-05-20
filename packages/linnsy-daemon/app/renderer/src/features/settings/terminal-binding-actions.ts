import type React from 'react';

import type { ChatAppState } from '../../stores/chat-app-state.js';

export type ChatStateSetter = React.Dispatch<React.SetStateAction<ChatAppState>>;

export async function bindMobileTerminalToConversation(
  conversationId: string,
  state: ChatAppState,
  setState: ChatStateSetter
): Promise<void> {
  if (state.client === null) {
    return;
  }
  const binding = await state.client.updateTerminalBinding(conversationId);
  setState((current) => ({
    ...current,
    terminalBinding: binding
  }));
}
