import React from 'react';

import type { ConversationItem } from '../projection/types.js';
import type { Locale } from '../../../lib/i18n.js';
import { UserBubble } from './UserBubble.js';
import { AssistantBubble } from './AssistantBubble.js';
import { ToolCallCard } from './ToolCallCard.js';
import { SubagentSummary } from './SubagentSummary.js';
import { SystemEvent } from './SystemEvent.js';
import { UserInterjection } from './UserInterjection.js';

// 按 ConversationItem.kind 分发到具体气泡组件。新增 kind 时在此处加 case。
// locale 由 ChatView 从 ChatAppState.preferences.language 透下来——不引入 React Context，
// 保持渲染层数据流单向（ChatAppState → ChatView → Message → 各 Bubble）。
export function Message({
  assistantCopyText,
  item,
  locale,
  animateEntry = false,
  onBeforeToolExpand
}: {
  assistantCopyText?: string;
  item: ConversationItem;
  locale: Locale;
  animateEntry?: boolean;
  onBeforeToolExpand?: () => void;
}): React.JSX.Element | null {
  const entryClassName = animateEntry ? ' message--entering' : '';
  switch (item.kind) {
    case 'user_bubble':
      return <UserBubble entryClassName={entryClassName} item={item} locale={locale} />;
    case 'assistant_bubble':
      return (
        <AssistantBubble
          entryClassName={entryClassName}
          item={item}
          locale={locale}
          {...(assistantCopyText === undefined ? {} : { copyText: assistantCopyText })}
        />
      );
    case 'tool_call_card':
      return (
        <ToolCallCard
          entryClassName={entryClassName}
          item={item}
          locale={locale}
          {...(onBeforeToolExpand === undefined ? {} : { onBeforeExpand: onBeforeToolExpand })}
        />
      );
    case 'subagent_summary':
      return <SubagentSummary entryClassName={entryClassName} item={item} locale={locale} />;
    case 'system_event':
      return <SystemEvent entryClassName={entryClassName} item={item} locale={locale} />;
    case 'user_interjection':
      return <UserInterjection entryClassName={entryClassName} item={item} locale={locale} />;
    default:
      assertNever(item);
      return null;
  }
}

// 编译期穷尽性检查：union 新增 kind 但忘了加 case 时，TS 会在此处报错。
function assertNever(value: never): never {
  throw new Error(`unhandled ConversationItem kind: ${JSON.stringify(value)}`);
}
