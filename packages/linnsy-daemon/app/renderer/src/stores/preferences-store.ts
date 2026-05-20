import { create } from 'zustand';

import { defaultPreferences } from './default-preferences.js';
import type { UiPreferences } from '../lib/daemon-api.js';

export interface PreferencesStoreSnapshot {
  preferences: UiPreferences;
}

export function createEmptyPreferencesStoreSnapshot(): PreferencesStoreSnapshot {
  return {
    preferences: defaultPreferences
  };
}

export const usePreferencesStore = create<PreferencesStoreSnapshot>(() => (
  createEmptyPreferencesStoreSnapshot()
));

export function replacePreferencesStore(snapshot: PreferencesStoreSnapshot): void {
  usePreferencesStore.setState(snapshot, true);
}
