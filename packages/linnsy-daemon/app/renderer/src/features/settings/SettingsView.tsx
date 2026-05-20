import React from 'react';

import type { ChatAppState } from '../../stores/chat-app-state.js';
import { t } from '../../lib/i18n.js';
import { ApplicationConnectionsPanel } from './ApplicationConnectionsPanel.js';
import { AppearanceSettings } from './AppearanceSettings.js';
import { ChannelsSettings } from './ChannelsSettings.js';
import { GeneralSettings } from './GeneralSettings.js';
import { MemorySettingsPanel } from './MemorySettingsPanel.js';
import { ModelSettingsPanel } from './ModelSettingsPanel.js';
import { ScrollArea } from '../../components/ScrollArea.js';
import { settingsTabs, type SettingsTabId } from '../../shell/app-shell-constants.js';

export function SettingsView(props: {
  activeTab: SettingsTabId;
  state: ChatAppState;
  setActiveTab(tab: SettingsTabId): void;
  setState: React.Dispatch<React.SetStateAction<ChatAppState>>;
}): React.JSX.Element {
  const active = settingsTabs.find((tab) => tab.id === props.activeTab) ?? settingsTabs[0];
  const locale = props.state.preferences.language;

  return (
    <ScrollArea as="section" aria-label={t(locale, 'settingsTitle')} className="settings-view">
      <div className="settings-shell">
        <header className="settings-header">
          <div>
            <h1>{t(locale, active.labelKey)}</h1>
          </div>
        </header>
        <SettingsPanel
          activeTab={props.activeTab}
          state={props.state}
          setState={props.setState}
        />
      </div>
    </ScrollArea>
  );
}

function SettingsPanel(props: {
  activeTab: SettingsTabId;
  state: ChatAppState;
  setState: React.Dispatch<React.SetStateAction<ChatAppState>>;
}): React.JSX.Element {
  if (props.activeTab === 'general') {
    return <GeneralSettings state={props.state} setState={props.setState} />;
  }
  if (props.activeTab === 'memory') {
    return <MemorySettingsPanel client={props.state.client} locale={props.state.preferences.language} />;
  }
  if (props.activeTab === 'appearance') {
    return <AppearanceSettings state={props.state} setState={props.setState} />;
  }
  if (props.activeTab === 'providers') {
    return <ModelSettingsPanel client={props.state.client} locale={props.state.preferences.language} />;
  }
  if (props.activeTab === 'channels') {
    return <ChannelsSettings state={props.state} setState={props.setState} />;
  }
  return (
    <ApplicationConnectionsPanel
      applicationConnections={props.state.applicationConnections}
      client={props.state.client}
      locale={props.state.preferences.language}
      setState={props.setState}
    />
  );
}
