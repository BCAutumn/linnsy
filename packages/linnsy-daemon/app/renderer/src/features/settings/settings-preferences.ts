import type React from 'react';

import type { ChatAppState } from '../../stores/chat-app-state.js';
import type { UiPreferences } from '../../lib/daemon-api.js';

export async function updatePreference<K extends keyof UiPreferences>(
  key: K,
  value: UiPreferences[K],
  state: ChatAppState,
  setState: React.Dispatch<React.SetStateAction<ChatAppState>>
): Promise<void> {
  setState((current) => ({
    ...current,
    preferences: {
      ...current.preferences,
      [key]: value
    }
  }));
  if (state.client !== null) {
    await state.client.setUiPreference(key, value);
  }
}
