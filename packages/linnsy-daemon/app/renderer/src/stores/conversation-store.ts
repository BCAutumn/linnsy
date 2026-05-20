import { create } from 'zustand';

import type {
  ConversationSummary,
  DaemonApiClient,
  TerminalBindingSnapshot
} from '../lib/daemon-api.js';

export interface ConversationStoreSnapshot {
  client: DaemonApiClient | null;
  conversations: ConversationSummary[];
  selectedConversationId: string | null;
  pendingDesktopConversation: boolean;
  terminalBinding: TerminalBindingSnapshot | null;
  status: string;
  error: string | null;
}

export function createEmptyConversationStoreSnapshot(): ConversationStoreSnapshot {
  return {
    client: null,
    conversations: [],
    selectedConversationId: null,
    pendingDesktopConversation: true,
    terminalBinding: null,
    status: '',
    error: null
  };
}

export const useConversationStore = create<ConversationStoreSnapshot>(() => (
  createEmptyConversationStoreSnapshot()
));

export function replaceConversationStore(snapshot: ConversationStoreSnapshot): void {
  useConversationStore.setState(snapshot, true);
}
