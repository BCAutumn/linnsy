import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import type {
  DaemonApiClient,
  UiPreferences
} from '../lib/daemon-api.js';
import {
  createDefaultDaemonClient,
  getDesktopBridge
} from '../lib/desktop-bridge.js';
import { getChannelLifecycleLabel, getWechatStatus, useChannelStatuses } from '../lib/channels/desktop-channels.js';
import { applyThemeModeNow } from '../lib/early-theme.js';
import { t } from '../lib/i18n.js';
import {
  readBootUiHint,
  writeBootUiHint
} from '../lib/boot-ui-hint.js';
import { createRuntimeEventBatcher } from '../lib/runtime-event-batcher.js';
import { applyRuntimeClientEvents } from '../lib/runtime-event-reducer.js';
import { projectionFromHistoryWithEvents } from '../lib/conversations/hydrate-actions.js';
import { createInitialState } from '../features/chat/projection/state.js';
import {
  resetChatStores,
  setChatAppState,
  type ChatAppState,
  useChatAppStateSnapshot
} from '../stores/chat-app-state.js';
import { ChatView } from '../features/chat/ChatView.js';
import { OnboardingView } from '../features/onboarding/OnboardingView.js';
import { ScheduledView } from '../features/scheduled/ScheduledView.js';
import { SettingsView } from '../features/settings/SettingsView.js';
import { AppSidebar, ConnectionStatus } from './Sidebar.js';
import { type SettingsTabId } from './app-shell-constants.js';
import { clampSidebarWidth } from './sidebar-width.js';
import {
  defaultPreferences,
  loadDesktopDataForState,
} from './desktop-data.js';
import {
  connectDesktop,
  formatDaemonStatusBanner,
  formatErrorBanner,
  markConnected,
  translateUnknownError,
  wasRecentlyConnected
} from './app-shell-runtime.js';

export interface AppShellProps {
  initialPath?: string;
  clientFactory?: () => Promise<DaemonApiClient>;
}

type AppState = ChatAppState;
type DesktopShellStyle = React.CSSProperties & {
  '--sidebar-width': string;
};

export function AppShell({
  initialPath = '/chat',
  clientFactory = createDefaultDaemonClient
}: AppShellProps): React.JSX.Element {
  const [bootState] = useState(createBootAppState);
  const [storesBooted, setStoresBooted] = useState(false);
  useLayoutEffect(() => {
    resetChatStores(bootState);
    setStoresBooted(true);
  }, [bootState]);
  const channelStatuses = useChannelStatuses();
  const state = useChatAppStateSnapshot();
  const setState = setChatAppState;
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    setState((current) => ({
      ...current,
      channelStatuses: channelStatuses.byId
    }));
  }, [channelStatuses.byId]);

  useEffect(() => {
    applyThemeModeNow(state.preferences['theme.mode']);
  }, [state.preferences['theme.mode']]);

  useEffect(() => {
    const desktop = getDesktopBridge();
    if (desktop?.onDaemonStatusChanged === undefined) {
      return undefined;
    }
    return desktop.onDaemonStatusChanged((daemonStatus) => {
      if (daemonStatus.lifecycle === 'starting' || daemonStatus.lifecycle === 'running') {
        return;
      }
      setState((current) => ({
        ...current,
        status: t(current.preferences.language, 'connectionStatusLiveReconnecting'),
        error: formatDaemonStatusBanner(current.preferences.language, daemonStatus)
      }));
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    void connectDesktop(clientFactory, {
      cancelled: () => !mounted,
      onRetry: () => {
        if (!mounted) return;
        setState((current) => ({
          ...current,
          status: wasRecentlyConnected() ? current.status : t(current.preferences.language, 'connectionStarting'),
          error: null
        }));
      },
      onConnected: (client, initialData) => {
        if (!mounted) return;
        markConnected();
        writeBootUiHint(initialData.preferences);
        setState((current) => ({
          ...current,
          client,
          preferences: initialData.preferences,
          conversations: initialData.conversations,
          terminalBinding: initialData.terminalBinding,
          applicationConnections: initialData.applicationConnections,
          selectedConversationId: initialData.selectedConversationId,
          pendingDesktopConversation: initialData.selectedConversationId === null,
          projection: projectionFromHistoryWithEvents(initialData.selectedConversationId, initialData.messages, initialData.events),
          status: t(initialData.preferences.language, 'connectionStatusConnected'),
          error: null
        }));
      },
      onFailure: (error, retrying) => {
        if (!mounted) return;
        setState((current) => ({
          ...current,
          status: retrying
            ? wasRecentlyConnected() ? current.status : t(current.preferences.language, 'connectionReconnecting')
            : t(current.preferences.language, 'connectionFailed'),
          error: retrying ? null : formatErrorBanner(
            current.preferences.language,
            translateUnknownError(error, current.preferences.language)
          )
        }));
      }
    });
    return () => {
      mounted = false;
    };
  }, [clientFactory]);

  useEffect(() => {
    const client = state.client;
    if (client === null) {
      return undefined;
    }
    const activeClient: DaemonApiClient = client;

    const eventBatcher = createRuntimeEventBatcher({
      apply(events) {
        setState((current) => applyRuntimeClientEvents(current, events));
      }
    });
    let restartRefreshToken = 0;

    function rehydrateAfterDaemonRestart(): void {
      const token = ++restartRefreshToken;
      eventBatcher.flush();
      setState((current) => ({
        ...current,
        projection: createInitialState(current.selectedConversationId),
        status: t(current.preferences.language, 'connectionStatusLiveReconnecting'),
        error: null
      }));
      void loadDesktopDataForState(activeClient, stateRef.current)
        .then((nextData) => {
          if (token !== restartRefreshToken) {
            return;
          }
          markConnected();
          writeBootUiHint(nextData.preferences);
          setState((current) => ({
            ...current,
            client: activeClient,
            preferences: nextData.preferences,
            conversations: nextData.conversations,
            terminalBinding: nextData.terminalBinding,
            applicationConnections: nextData.applicationConnections,
            selectedConversationId: nextData.selectedConversationId,
            pendingDesktopConversation: nextData.selectedConversationId === null,
            projection: projectionFromHistoryWithEvents(
              nextData.selectedConversationId,
              nextData.messages,
              nextData.events
            ),
            status: t(nextData.preferences.language, 'connectionStatusConnected'),
            error: null
          }));
        })
        .catch((error: unknown) => {
          if (token !== restartRefreshToken) {
            return;
          }
          setState((current) => ({
            ...current,
            status: t(current.preferences.language, 'connectionStatusLiveReconnecting'),
            error: formatErrorBanner(
              current.preferences.language,
              translateUnknownError(error, current.preferences.language)
            )
          }));
        });
    }

    const stream = activeClient.openEventStream({
      onBackfill: (events) => {
        eventBatcher.flush();
        setState((current) => applyRuntimeClientEvents(current, events));
      },
      onBootInstanceChanged: () => {
        rehydrateAfterDaemonRestart();
      },
      onReady: () => {
        eventBatcher.flush();
        setState((current) => ({
          ...current,
          status: t(current.preferences.language, 'connectionStatusConnected'),
          error: null
        }));
      },
      onEvent: (event) => {
        eventBatcher.push(event);
      },
      onError: () => {
        setState((current) => ({
          ...current,
          status: t(current.preferences.language, 'connectionStatusLiveReconnecting')
        }));
      }
    });

    return () => {
      restartRefreshToken += 1;
      eventBatcher.close();
      stream.close();
    };
  }, [state.client]);

  return (
    storesBooted
      ? (
          <MemoryRouter
            future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
            initialEntries={[initialPath]}
          >
            <DesktopShell state={state} setState={setState} />
          </MemoryRouter>
        )
      : <></>
  );
}

function createBootAppState(): AppState {
  // 首屏渲染前先把上次的 theme / language 注入 store，避免"先闪默认主题、
  // 再切到上次主题"的开屏跳变。daemon 拉到真实偏好后会立即覆盖。
  // hint 来自 preload 同步注入的 window.__LINNSY_BOOT__，dev 浏览器无 preload
  // 时拿到 null 走 default。详见 docs/04 §6.5。
  const hint = readBootUiHint();
  const cachedPreferences: UiPreferences = hint === null
    ? defaultPreferences
    : { ...defaultPreferences, ...hint };
  return {
    client: null,
    conversations: [],
    selectedConversationId: null,
    pendingDesktopConversation: true,
    terminalBinding: null,
    applicationConnections: null,
    projection: createInitialState(null),
    preferences: cachedPreferences,
    channelStatuses: new Map(),
    status: wasRecentlyConnected()
      ? t(cachedPreferences.language, 'connectionStatusConnected')
      : t(cachedPreferences.language, 'connectionStatusConnecting'),
    error: null
  };
}

function DesktopShell(props: {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
}): React.JSX.Element {
  const location = useLocation();
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTabId>('general');
  const isSettings = location.pathname.startsWith('/settings');
  const isOnboarding = location.pathname.startsWith('/onboarding');
  const isScheduled = location.pathname.startsWith('/schedule');
  const isChat = !isSettings && !isOnboarding && !isScheduled;
  const locale = props.state.preferences.language;
  const wechatStatus = getWechatStatus(props.state.channelStatuses);
  const wechatConnected = wechatStatus?.lifecycle === 'connected';
  const shellStyle: DesktopShellStyle = {
    '--sidebar-width': `${String(clampSidebarWidth(props.state.preferences['sidebar.width_px']))}px`
  };

  return (
    <div
      className="linnsy-window"
      data-mode={props.state.preferences['theme.mode']}
      data-screen={isSettings ? 'settings' : isOnboarding ? 'onboarding' : isScheduled ? 'scheduled' : 'chat'}
      data-theme={props.state.preferences['theme.primary_color']}
      style={shellStyle}
    >
      <AppSidebar
        activeSettingsTab={activeSettingsTab}
        isChat={isChat}
        isSettings={isSettings}
        locale={locale}
        state={props.state}
        setActiveSettingsTab={setActiveSettingsTab}
        setState={props.setState}
      />
      <main aria-label={t(locale, 'appMainArea')} className="main-wrap">
        <div className="main-topbar">
          <ConnectionStatus
            online={wechatConnected}
            label={getChannelLifecycleLabel(locale, wechatStatus)}
          />
        </div>
        {props.state.error === null ? null : <div className="error-banner">{props.state.error}</div>}
        <Routes>
          <Route
            path="/chat"
            element={<ChatView state={props.state} setState={props.setState} />}
          />
          <Route
            path="/settings"
            element={(
              <SettingsView
                activeTab={activeSettingsTab}
                state={props.state}
                setActiveTab={setActiveSettingsTab}
                setState={props.setState}
              />
            )}
          />
          <Route path="/onboarding/:step" element={<OnboardingView locale={locale} />} />
          <Route path="/schedule" element={<ScheduledView state={props.state} setState={props.setState} />} />
          <Route path="*" element={<ChatView state={props.state} setState={props.setState} />} />
        </Routes>
      </main>
    </div>
  );
}
