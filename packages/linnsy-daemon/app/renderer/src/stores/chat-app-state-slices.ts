import type { ConversationStoreSnapshot } from './conversation-store.js';
import type { ProjectionStoreSnapshot } from './projection-store.js';
import type { PreferencesStoreSnapshot } from './preferences-store.js';
import type { ApplicationConnectionsStoreSnapshot } from './application-connections-store.js';

export interface ChatAppState
  extends ConversationStoreSnapshot,
    ProjectionStoreSnapshot,
    PreferencesStoreSnapshot,
    ApplicationConnectionsStoreSnapshot {}

export interface ChatAppStateSlices {
  conversation: ConversationStoreSnapshot;
  projection: ProjectionStoreSnapshot;
  preferences: PreferencesStoreSnapshot;
  applicationConnections: ApplicationConnectionsStoreSnapshot;
}

export function splitChatAppState(state: ChatAppState): ChatAppStateSlices {
  return {
    conversation: {
      client: state.client,
      conversations: state.conversations,
      selectedConversationId: state.selectedConversationId,
      pendingDesktopConversation: state.pendingDesktopConversation,
      terminalBinding: state.terminalBinding,
      status: state.status,
      error: state.error
    },
    projection: {
      projection: state.projection
    },
    preferences: {
      preferences: state.preferences
    },
    applicationConnections: {
      applicationConnections: state.applicationConnections,
      channelStatuses: state.channelStatuses
    }
  };
}

export function didConversationSliceChange(left: ChatAppState, right: ChatAppState): boolean {
  return left.client !== right.client
    || left.conversations !== right.conversations
    || left.selectedConversationId !== right.selectedConversationId
    || left.pendingDesktopConversation !== right.pendingDesktopConversation
    || left.terminalBinding !== right.terminalBinding
    || left.status !== right.status
    || left.error !== right.error;
}

export function didProjectionSliceChange(left: ChatAppState, right: ChatAppState): boolean {
  return left.projection !== right.projection;
}

export function didPreferencesSliceChange(left: ChatAppState, right: ChatAppState): boolean {
  return left.preferences !== right.preferences;
}

export function didApplicationConnectionsSliceChange(left: ChatAppState, right: ChatAppState): boolean {
  return left.applicationConnections !== right.applicationConnections
    || left.channelStatuses !== right.channelStatuses;
}
