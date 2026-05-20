import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  canEditCurrentConversation,
  canSendCurrentDesktopMessage,
  sendDesktopMessage
} from '../../lib/conversations/desktop-send.js';
import type { ChatAppState } from '../../stores/chat-app-state.js';
import { buildChatScrollWatchKey } from './scroll/chat-scroll.js';
import { useChatScrollClip } from './scroll/chat-scroll-clip.js';
import { t } from '../../lib/i18n.js';
import { useJumpToBottomNotice } from './scroll/jump-to-bottom.js';
import { useStickyScroll } from './scroll/use-sticky-scroll.js';
import { ChatComposer } from './ChatComposer.js';
import { ChatMarkdownView } from './markdown/ChatMarkdownView.js';
import { ScrollToBottomButton } from './ScrollToBottomButton.js';
import { ScrollArea } from '../../components/ScrollArea.js';
import { Message } from './items/Message.js';
import { selectAllItems } from './projection/helpers/selectors.js';
import { maybeWarnLargeConversation } from './chat-render-observer.js';
import { useMessageEntryAnimation } from './use-message-entry-animation.js';
import { buildAssistantCopyTextByItemId } from './items/assistant-copy.js';

export function ChatView(props: {
  state: ChatAppState;
  setState: React.Dispatch<React.SetStateAction<ChatAppState>>;
}): React.JSX.Element {
  const [draft, setDraft] = useState('');
  const locale = props.state.preferences.language;
  const canEdit = canEditCurrentConversation(props.state);
  const canSend = canSendCurrentDesktopMessage(props.state, draft);
  const items = useMemo(() => selectAllItems(props.state.projection), [props.state.projection]);
  const assistantCopyTextByItemId = useMemo(
    () => buildAssistantCopyTextByItemId(items, props.state.projection.settledRunIds),
    [items, props.state.projection.settledRunIds]
  );
  const animatedEntryItemIds = useMessageEntryAnimation(props.state.selectedConversationId, items);
  const scrollWatchKey = buildChatScrollWatchKey(items);
  const messageListRef = useRef<HTMLElement>(null);
  const composerWrapRef = useRef<HTMLDivElement>(null);
  const stickyScroll = useStickyScroll<HTMLElement>({
    contentRef: messageListRef,
    resetKey: props.state.selectedConversationId,
    watchKey: scrollWatchKey
  });
  const scrollClip = useChatScrollClip({
    composerRef: composerWrapRef,
    messageListRef,
    resetKey: props.state.selectedConversationId,
    scrollRef: stickyScroll.ref,
    watchKey: scrollWatchKey
  });
  const jumpNotice = useJumpToBottomNotice({
    itemCount: items.length,
    resetKey: props.state.selectedConversationId,
    stuckToBottom: stickyScroll.stuckToBottom
  });
  useEffect(() => {
    maybeWarnLargeConversation({
      conversationId: props.state.selectedConversationId,
      itemCount: items.length
    });
  }, [items.length, props.state.selectedConversationId]);

  return (
    <ScrollArea
      as="section"
      className="chat-view"
      onScroll={() => {
        stickyScroll.onScroll();
        scrollClip.updateClip();
      }}
      ref={stickyScroll.ref}
    >
      <article aria-label={t(locale, 'chatConversationArea')} className="message-list" ref={messageListRef}>
        {items.length === 0 ? (
          <div className="message assistant msg">
            <ChatMarkdownView content={t(locale, 'chatEmptyGreeting')} />
          </div>
        ) : items.map((item) => (
          <Message
            item={item}
            locale={locale}
            key={item.id}
            animateEntry={animatedEntryItemIds.has(item.id)}
            onBeforeToolExpand={stickyScroll.pauseAutoScrollForNextFrame}
            {...(assistantCopyTextByItemId.has(item.id)
              ? { assistantCopyText: assistantCopyTextByItemId.get(item.id) ?? '' }
              : {})}
          />
        ))}
      </article>
      <div className="composer-wrap" ref={composerWrapRef}>
        {items.length > 0 ? (
          <div className="jump-to-bottom-wrap">
            <ScrollToBottomButton
              ariaLabel={
                jumpNotice.pendingItemCount > 0
                  ? t(locale, 'chatJumpToBottomWithCount', { count: jumpNotice.pendingItemCount })
                  : t(locale, 'chatJumpToBottom')
              }
              pendingItemCount={jumpNotice.pendingItemCount}
              title={t(locale, 'chatJumpToBottom')}
              visible={!stickyScroll.stuckToBottom}
              onClick={() => {
                stickyScroll.jumpToBottom();
                scrollClip.updateClip();
              }}
            />
          </div>
        ) : null}
        <ChatComposer
          canSend={canSend}
          disabled={!canEdit}
          draft={draft}
          locale={locale}
          onDraftChange={setDraft}
          {...(canEdit ? {} : { placeholder: t(locale, 'composerReadOnlyPlaceholder') })}
          onSend={() => {
            if (!canSend) return;
            void sendDesktopMessage(draft, props.state, props.setState);
            setDraft('');
          }}
        />
      </div>
    </ScrollArea>
  );
}
