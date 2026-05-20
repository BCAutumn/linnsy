import type { UiPreferences } from '../lib/daemon-api.js';

export const defaultPreferences: UiPreferences = {
  'theme.mode': 'auto',
  'theme.primary_color': 'distant_sky',
  'font.size': 'medium',
  'sidebar.width_px': 260,
  'sidebar.archived_collapsed': true,
  last_opened_conversation_id: null,
  language: 'zh-CN',
  'scheduled.skip_inactive_delete_confirm': false
};
