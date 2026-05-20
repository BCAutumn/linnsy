import type { I18nKey } from '../lib/i18n.js';
import type { FluentIconName } from '../components/FluentIcon.js';

export const settingsTabs = [
  { id: 'general', labelKey: 'settingsGeneral', icon: 'settings' },
  { id: 'appearance', labelKey: 'settingsAppearance', icon: 'color' },
  { id: 'providers', labelKey: 'settingsProviders', icon: 'bot' },
  { id: 'memory', labelKey: 'settingsMemory', icon: 'brainCircuit' },
  { id: 'channels', labelKey: 'settingsChannels', icon: 'phone' },
  { id: 'appConnections', labelKey: 'settingsAppConnections', icon: 'apps' }
] as const satisfies ReadonlyArray<{
  id: string;
  labelKey: I18nKey;
  icon: FluentIconName;
}>;

export type SettingsTabId = (typeof settingsTabs)[number]['id'];
