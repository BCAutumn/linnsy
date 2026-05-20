import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';

import type { ConversationSummary } from '../lib/daemon-api.js';
import type { ChatAppState } from '../stores/chat-app-state.js';
import {
  archiveConversation,
  deleteConversation,
  renameConversation,
  setConversationPinned
} from '../lib/conversations/crud-actions.js';
import { selectConversation } from '../lib/conversations/hydrate-actions.js';
import { startNewDesktopConversation } from '../lib/conversations/desktop-send.js';
import { orderConversationsForSidebar } from '../lib/conversation-list.js';
import { t, type Locale } from '../lib/i18n.js';
import { FluentIcon, type FluentIconName } from '../components/FluentIcon.js';
import { ScrollArea } from '../components/ScrollArea.js';
import { settingsTabs, type SettingsTabId } from './app-shell-constants.js';
import { ChatSidebarConversationItem } from './ChatSidebarConversationItem.js';
import { DeleteConversationDialog } from './DeleteConversationDialog.js';
import { RenameConversationDialog } from './RenameConversationDialog.js';
import {
  SIDEBAR_WIDTH_KEYBOARD_STEP,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  clampSidebarWidth,
  deriveSidebarWidthFromDrag
} from './sidebar-width.js';

export function AppSidebar(props: {
  activeSettingsTab: SettingsTabId;
  isChat: boolean;
  isSettings: boolean;
  locale: Locale;
  state: ChatAppState;
  setActiveSettingsTab(tab: SettingsTabId): void;
  setState: React.Dispatch<React.SetStateAction<ChatAppState>>;
}): React.JSX.Element {
  const navigate = useNavigate();
  const dragState = React.useRef<{
    readonly startClientX: number;
    readonly startWidth: number;
  } | null>(null);
  const cleanupResizeListeners = React.useRef<(() => void) | null>(null);
  const sidebarWidth = clampSidebarWidth(props.state.preferences['sidebar.width_px']);

  const setSidebarWidth = React.useCallback((width: number) => {
    const nextWidth = clampSidebarWidth(width);
    props.setState((current) => (
      current.preferences['sidebar.width_px'] === nextWidth
        ? current
        : {
            ...current,
            preferences: {
              ...current.preferences,
              'sidebar.width_px': nextWidth
            }
          }
    ));
    return nextWidth;
  }, [props.setState]);

  const persistSidebarWidth = React.useCallback((width: number) => {
    const nextWidth = setSidebarWidth(width);
    if (props.state.client !== null) {
      void props.state.client.setUiPreference('sidebar.width_px', nextWidth);
    }
  }, [props.state.client, setSidebarWidth]);

  const startSidebarResize = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    cleanupResizeListeners.current?.();
    dragState.current = {
      startClientX: event.clientX,
      startWidth: sidebarWidth
    };
    document.documentElement.classList.add('is-sidebar-resizing');

    const handlePointerMove = (moveEvent: PointerEvent): void => {
      const currentDrag = dragState.current;
      if (currentDrag === null) {
        return;
      }
      setSidebarWidth(deriveSidebarWidthFromDrag({
        ...currentDrag,
        currentClientX: moveEvent.clientX
      }));
    };

    const stopResize = (stopEvent: PointerEvent): void => {
      const currentDrag = dragState.current;
      dragState.current = null;
      cleanupResizeListeners.current?.();
      if (currentDrag === null) {
        return;
      }
      persistSidebarWidth(deriveSidebarWidthFromDrag({
        ...currentDrag,
        currentClientX: stopEvent.clientX
      }));
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
    cleanupResizeListeners.current = () => {
      document.documentElement.classList.remove('is-sidebar-resizing');
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
      cleanupResizeListeners.current = null;
    };
  }, [persistSidebarWidth, setSidebarWidth, sidebarWidth]);

  React.useEffect(() => () => {
    dragState.current = null;
    cleanupResizeListeners.current?.();
  }, []);

  const resizeSidebarWithKeyboard = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    persistSidebarWidth(sidebarWidth + direction * SIDEBAR_WIDTH_KEYBOARD_STEP);
  }, [persistSidebarWidth, sidebarWidth]);

  return (
    <aside
      aria-label={t(props.locale, 'appSidebar')}
      className="linnsy-sidebar"
    >
      <div className="sidebar-titlebar" />
      {props.isSettings ? (
        <SettingsSidebar
          activeTab={props.activeSettingsTab}
          locale={props.locale}
          onSelect={(tab) => {
            props.setActiveSettingsTab(tab);
          }}
        />
      ) : (
        <ChatSidebar
          activeConversationId={props.isChat ? props.state.selectedConversationId : null}
          boundConversationId={props.state.terminalBinding?.conversationId ?? null}
          conversations={props.state.conversations}
          locale={props.locale}
          onNewConversation={() => {
            navigate('/chat');
            startNewDesktopConversation(props.setState);
          }}
          onSelect={(conversationId) => {
            // 从任务管理 / 定时安排等子页点历史对话时，先把主区域切回对话页，再加载目标会话。
            navigate('/chat');
            void selectConversation(conversationId, props.state, props.setState);
          }}
          setState={props.setState}
          state={props.state}
        />
      )}
      {props.isSettings ? null : (
        <div className="sidebar-bottom">
          <SidebarNavLink label={t(props.locale, 'settingsEntry')} to="/settings" icon="settings" />
        </div>
      )}
      <div
        aria-label={t(props.locale, 'sidebarResizeHandle')}
        aria-orientation="vertical"
        aria-valuemax={SIDEBAR_WIDTH_MAX}
        aria-valuemin={SIDEBAR_WIDTH_MIN}
        aria-valuenow={sidebarWidth}
        className="sidebar-resize-handle"
        onKeyDown={resizeSidebarWithKeyboard}
        onPointerDown={startSidebarResize}
        role="separator"
        tabIndex={0}
      />
    </aside>
  );
}

export function ConnectionStatus(props: { online: boolean; label: string }): React.JSX.Element {
  return (
    <div className="conn-status">
      <span className={`conn-dot ${props.online ? 'conn-dot--online' : 'conn-dot--offline'}`} />
      <span>{props.label}</span>
    </div>
  );
}

function ChatSidebar(props: {
  activeConversationId: string | null;
  conversations: ConversationSummary[];
  boundConversationId: string | null;
  locale: Locale;
  onNewConversation(): void;
  onSelect(conversationId: string): void;
  setState: React.Dispatch<React.SetStateAction<ChatAppState>>;
  state: ChatAppState;
}): React.JSX.Element {
  const [renameTarget, setRenameTarget] = React.useState<ConversationSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<ConversationSummary | null>(null);
  const visibleConversations = orderConversationsForSidebar(props.conversations, props.boundConversationId);

  return (
    <div className="sidebar-pane sidebar-pane--chat">
      <div className="sidebar-actions">
        <button
          className="new-conv-btn"
          onClick={() => {
            props.onNewConversation();
          }}
          type="button"
        >
          <FluentIcon aria-hidden="true" name="add" />
          <span>{t(props.locale, 'newConversation')}</span>
        </button>
      </div>
      <label className="search-wrap">
        <FluentIcon aria-hidden="true" className="search-ic" name="search" />
        <input
          aria-label={t(props.locale, 'searchConversations')}
          disabled
          placeholder={t(props.locale, 'searchConversationsPlaceholder')}
          type="search"
        />
      </label>
      <div className="sidebar-inline-nav">
        <SidebarNavLink label={t(props.locale, 'scheduledSidebar')} to="/schedule" icon="clock" />
      </div>
      <div className="sidebar-section-label">{t(props.locale, 'recent')}</div>
      <ScrollArea as="section" className="conversation-list" aria-label={t(props.locale, 'conversationList')}>
        {visibleConversations.length === 0 ? (
          <p className="empty-sidebar-text">{t(props.locale, 'conversationEmpty')}</p>
        ) : visibleConversations.map((conversation) => (
          <ChatSidebarConversationItem
            active={conversation.conversationId === props.activeConversationId}
            boundToMobileTerminal={conversation.conversationId === props.boundConversationId}
            conversation={conversation}
            key={conversation.conversationId}
            locale={props.locale}
            onArchive={() => {
              void archiveConversation(conversation.conversationId, props.state, props.setState);
            }}
            onDelete={() => {
              setDeleteTarget(conversation);
            }}
            onRename={() => {
              setRenameTarget(conversation);
            }}
            onSelect={() => {
              props.onSelect(conversation.conversationId);
            }}
            onSetPinned={(pinned) => {
              void setConversationPinned(conversation.conversationId, pinned, props.state, props.setState);
            }}
          />
        ))}
      </ScrollArea>
      {renameTarget === null ? null : (
        <RenameConversationDialog
          conversation={renameTarget}
          locale={props.locale}
          onClose={() => {
            setRenameTarget(null);
          }}
          onSubmit={(title) => {
            const target = renameTarget;
            setRenameTarget(null);
            void renameConversation(target.conversationId, title, props.state, props.setState);
          }}
        />
      )}
      {deleteTarget === null ? null : (
        <DeleteConversationDialog
          conversation={deleteTarget}
          locale={props.locale}
          onClose={() => {
            setDeleteTarget(null);
          }}
          onConfirm={() => {
            const target = deleteTarget;
            setDeleteTarget(null);
            void deleteConversation(target.conversationId, props.state, props.setState);
          }}
        />
      )}
    </div>
  );
}

function SettingsSidebar(props: {
  activeTab: SettingsTabId;
  locale: Locale;
  onSelect(tab: SettingsTabId): void;
}): React.JSX.Element {
  return (
    <div className="sidebar-pane sidebar-pane--settings">
      <ScrollArea as="nav" aria-label={t(props.locale, 'settingsCategoryNav')} className="settings-tabs-nav">
        <NavLink className="settings-back-link" to="/chat">
          <FluentIcon aria-hidden="true" name="chevronLeft" size={17} />
          {t(props.locale, 'backToChat')}
        </NavLink>
        {settingsTabs.map((tab) => (
          <button
            className={`tab-btn${tab.id === props.activeTab ? ' active selected' : ''}`}
            key={tab.id}
            onClick={() => {
              props.onSelect(tab.id);
            }}
            type="button"
          >
            <FluentIcon aria-hidden="true" name={tab.icon} size={17} />
            {t(props.locale, tab.labelKey)}
          </button>
        ))}
      </ScrollArea>
    </div>
  );
}

function SidebarNavLink(props: {
  label: string;
  to: string;
  icon: FluentIconName;
}): React.JSX.Element {
  return (
    <NavLink
      aria-label={props.label}
      className={({ isActive }) => `sidebar-nav-link${isActive ? ' active selected' : ''}`}
      to={props.to}
    >
      <FluentIcon aria-hidden="true" name={props.icon} size={17} />
      <span>{props.label}</span>
    </NavLink>
  );
}
