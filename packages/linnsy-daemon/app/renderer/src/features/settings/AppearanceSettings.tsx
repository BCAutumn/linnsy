import React from 'react';

import type { ChatAppState } from '../../stores/chat-app-state.js';
import {
  getThemeModeLabels,
  getThemePrimaryColorLabels,
  t
} from '../../lib/i18n.js';
import { themeModes, themePrimaryColorOptions } from '../../lib/theme.js';
import { SegmentedControl } from '../../components/SegmentedControl.js';
import { SettingsRangeSlider } from '../../components/SettingsRangeSlider.js';
import { SettingRow, SettingsSection } from './SettingsLayout.js';
import { updatePreference } from './settings-preferences.js';
import { SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN } from '../../shell/sidebar-width.js';

export function AppearanceSettings(props: {
  state: ChatAppState;
  setState: React.Dispatch<React.SetStateAction<ChatAppState>>;
}): React.JSX.Element {
  const locale = props.state.preferences.language;
  const themeModeLabels = getThemeModeLabels(locale);
  const modeOptions = themeModes.map((mode) => ({
    value: mode,
    label: themeModeLabels[mode]
  }));

  return (
    <div className="settings-stack">
      <SettingsSection description={t(locale, 'appearanceThemeSectionDescription')} title={t(locale, 'appearanceThemeSectionTitle')}>
        <div className="theme-grid">
          {themePrimaryColorOptions.map((option) => {
            const labels = getThemePrimaryColorLabels(locale, option.key);
            return (
              <button
                className={`theme-tile${option.key === props.state.preferences['theme.primary_color'] ? ' active' : ''}`}
                key={option.key}
                onClick={() => {
                  void updatePreference('theme.primary_color', option.key, props.state, props.setState);
                }}
                data-theme-option={option.key}
                type="button"
              >
                <span className="theme-tile-name">{labels.primary}</span>
                <span className="theme-tile-en">{labels.secondary}</span>
              </button>
            );
          })}
        </div>
      </SettingsSection>
      <SettingsSection>
        <SettingRow label={t(locale, 'themeMode')} description={t(locale, 'themeModeDescription')}>
          <SegmentedControl
            ariaLabel={t(locale, 'themeMode')}
            onChange={(value) => {
              void updatePreference('theme.mode', value, props.state, props.setState);
            }}
            options={modeOptions}
            value={props.state.preferences['theme.mode']}
          />
        </SettingRow>
        <SettingRow
          label={t(locale, 'sidebarWidth')}
          description={t(locale, 'sidebarWidthDescription', { width: props.state.preferences['sidebar.width_px'] })}
        >
          <SettingsRangeSlider
            ariaLabel={t(locale, 'sidebarWidth')}
            max={SIDEBAR_WIDTH_MAX}
            min={SIDEBAR_WIDTH_MIN}
            minLabel={t(locale, 'sidebarWidthNarrow')}
            maxLabel={t(locale, 'sidebarWidthWide')}
            onChange={(width) => {
              void updatePreference('sidebar.width_px', width, props.state, props.setState);
            }}
            value={props.state.preferences['sidebar.width_px']}
            valueLabel={`${String(props.state.preferences['sidebar.width_px'])}px`}
          />
        </SettingRow>
      </SettingsSection>
    </div>
  );
}
