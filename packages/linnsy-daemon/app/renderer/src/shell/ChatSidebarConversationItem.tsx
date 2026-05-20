import React, { useMemo, useRef, useState } from 'react';

import type { ConversationSummary } from '../lib/daemon-api.js';
import { getConversationDisplayName } from '../lib/conversation-list.js';
import { t, type Locale } from '../lib/i18n.js';
import { formatRelativeTime } from '../lib/relative-time.js';
import { FluentIcon } from '../components/FluentIcon.js';
import { ChatSidebarMoreMenu, type ChatSidebarMenuItem } from './ChatSidebarMoreMenu.js';

export function ChatSidebarConversationItem(props: {
  active: boolean;
  boundToMobileTerminal: boolean;
  conversation: ConversationSummary;
  locale: Locale;
  onArchive: () => void;
  onDelete: () => void;
  onRename: () => void;
  onSelect: () => void;
  onSetPinned: (pinned: boolean) => void;
}): React.JSX.Element {
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const pinned = props.conversation.pinnedAt !== undefined;
  const menuItems = useMemo<ChatSidebarMenuItem[]>(() => {
    const items: ChatSidebarMenuItem[] = [{
      id: 'rename',
      label: t(props.locale, 'conversationMenuRename'),
      icon: 'edit',
      onSelect: props.onRename
    }];
    if (!props.boundToMobileTerminal) {
      items.push({
        id: pinned ? 'unpin' : 'pin',
        label: t(props.locale, pinned ? 'conversationMenuUnpin' : 'conversationMenuPin'),
        icon: 'pin',
        onSelect: () => {
          props.onSetPinned(!pinned);
        }
      });
      items.push({
        id: 'archive',
        label: t(props.locale, 'conversationMenuArchive'),
        icon: 'archive',
        onSelect: props.onArchive
      });
      items.push({
        id: 'delete',
        label: t(props.locale, 'conversationMenuDelete'),
        icon: 'delete',
        danger: true,
        onSelect: props.onDelete
      });
    }
    return items;
  }, [
    pinned,
    props.boundToMobileTerminal,
    props.locale,
    props.onArchive,
    props.onDelete,
    props.onRename,
    props.onSetPinned
  ]);

  return (
    <div
      className={[
        'conv-item',
        props.active ? 'active selected' : '',
        props.boundToMobileTerminal ? 'conv-item--terminal-bound' : '',
        pinned && !props.boundToMobileTerminal ? 'conv-item--pinned' : ''
      ].filter(Boolean).join(' ')}
    >
      <button
        className="conv-item-main"
        onClick={props.onSelect}
        type="button"
      >
        <span className="conv-title">{getConversationDisplayName(props.conversation)}</span>
        <span className="conv-meta">
          {props.boundToMobileTerminal ? (
            <FluentIcon aria-hidden="true" className="conv-terminal-icon" name="phone" size={14} />
          ) : pinned ? (
            <FluentIcon aria-hidden="true" className="conv-pin-icon" name="pin" size={14} />
          ) : null}
          <time className="conv-time">{formatRelativeTime(props.locale, props.conversation.lastActivityAt)}</time>
        </span>
      </button>
      <button
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label={t(props.locale, 'conversationMenuMore')}
        className="conv-more-btn"
        onClick={() => {
          setMenuOpen((current) => !current);
        }}
        ref={moreButtonRef}
        title={t(props.locale, 'conversationMenuMore')}
        type="button"
      >
        <FluentIcon aria-hidden="true" name="moreHorizontal" size={16} />
      </button>
      {menuOpen ? (
        <ChatSidebarMoreMenu
          ariaLabel={t(props.locale, 'conversationMenuMore')}
          anchorRef={moreButtonRef}
          items={menuItems}
          onClose={() => {
            setMenuOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
