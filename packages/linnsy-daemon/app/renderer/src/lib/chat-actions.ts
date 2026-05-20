export type { ChatAppState, ChatStateSetter } from '../stores/chat-app-state.js';

// 兼容旧调用方的会话动作门面；新增逻辑应优先放进 conversations/* 的职责模块。
export {
  archiveConversation,
  deleteConversation,
  renameConversation,
  setConversationPinned
} from './conversations/crud-actions.js';
export {
  canEditCurrentConversation,
  canSendCurrentDesktopMessage,
  sendDesktopMessage,
  startNewDesktopConversation
} from './conversations/desktop-send.js';
export {
  projectionFromHistory,
  projectionFromHistoryWithEvents,
  selectConversation
} from './conversations/hydrate-actions.js';
export {
  markConversationVisibleActivity,
  moveConversationToTopAfterMessage
} from './conversations/list-ops.js';
