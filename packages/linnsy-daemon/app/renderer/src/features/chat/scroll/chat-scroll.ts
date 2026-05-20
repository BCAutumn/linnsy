import type { ConversationItem } from '../projection/types.js';

// 流式渲染 sticky-scroll 的 watch key：监测 items 长度变化 + 流式 item 文本增长。
// 任何会让 DOM 高度变的字段变化都应进入 key（id / streaming 状态 / text 长度）。
export function buildChatScrollWatchKey(items: readonly ConversationItem[]): string {
  return items
    .map((item) => {
      const text = readItemText(item);
      const streamingMarker = item.kind === 'assistant_bubble' && item.streaming ? 'streaming' : 'settled';
      return [item.id, streamingMarker, String(text.length)].join(':');
    })
    .join('|');
}

function readItemText(item: ConversationItem): string {
  switch (item.kind) {
    case 'assistant_bubble':
      return [item.text, ...item.thoughtChunks.map((chunk) => chunk.text)].join('|');
    case 'user_bubble':
      return item.text;
    case 'subagent_summary':
      return item.summary;
    case 'system_event':
    case 'user_interjection':
      return item.detail;
    case 'tool_call_card':
      // 工具卡的高度变化由 status / data / observation / error 长度共同决定，进入 watch key 即可。
      return [item.status, formatDataForWatchKey(item.data), item.observation ?? '', item.error ?? ''].join('|');
    default:
      return '';
  }
}

function formatDataForWatchKey(data: Record<string, unknown> | undefined): string {
  if (data === undefined) {
    return '';
  }
  try {
    return JSON.stringify(data);
  } catch {
    // 这里仅用于滚动监听 key；异常数据降级到 key 列表即可。
    return Object.keys(data).join(',');
  }
}
