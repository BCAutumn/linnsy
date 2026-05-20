// 历史 hydrate 需要拿到最近工具卡，但流式 delta 会占很多事件。
// 这里主动使用后端允许的最大窗口，避免长回答把 tool_call.* 挤出历史投影。
export const historyEventHydrationLimit = 5000;
