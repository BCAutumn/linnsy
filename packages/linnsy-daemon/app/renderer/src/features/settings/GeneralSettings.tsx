import React, { useState } from 'react';

import type { UiPreferences } from '../../lib/daemon-api.js';
import type { ChatAppState } from '../../stores/chat-app-state.js';
import { t, type Locale } from '../../lib/i18n.js';
import { ActionButtons } from '../../components/ActionButtons.js';
import { AppDialog } from '../../components/AppDialog.js';
import { CustomSelect, type CustomSelectOption } from '../../components/CustomSelect.js';
import { SettingRow, SettingsSection } from './SettingsLayout.js';
import { updatePreference } from './settings-preferences.js';

export function GeneralSettings(props: {
  state: ChatAppState;
  setState: React.Dispatch<React.SetStateAction<ChatAppState>>;
}): React.JSX.Element {
  const locale = props.state.preferences.language;
  const languageOptions: ReadonlyArray<CustomSelectOption<UiPreferences['language']>> = [
    { value: 'zh-CN', text: t(locale, 'languageChinese') },
    { value: 'en-US', text: t(locale, 'languageEnglish') }
  ];
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  return (
    <div className="settings-stack">
      <SettingsSection description={t(locale, 'generalSectionDescription')} title={t(locale, 'generalSectionTitle')}>
        <SettingRow label={t(locale, 'language')} description={t(locale, 'languageDescription')}>
          <CustomSelect
            ariaLabel={t(locale, 'language')}
            value={props.state.preferences.language}
            options={languageOptions}
            title={t(locale, 'language')}
            fallbackPlaceholder={t(locale, 'customSelectPlaceholder')}
            fallbackTitle={t(locale, 'customSelectTitle')}
            minWidth="160px"
            width="160px"
            onChange={(value) => {
              void updatePreference('language', value, props.state, props.setState);
            }}
          />
        </SettingRow>
        <SettingRow
          label={t(locale, 'preferencesResetLabel')}
          description={resetMessage === null
            ? t(locale, 'preferencesResetDescription')
            : resetMessage}
        >
          <ActionButtons
            isPrimaryActionDisabled={resetBusy || props.state.client === null}
            onPrimaryAction={() => {
              setResetDialogOpen(true);
            }}
            primaryActionText={t(locale, 'preferencesResetAction')}
            primaryVariant="neutral"
            showSecondaryAction={false}
            size="sm"
          />
        </SettingRow>
      </SettingsSection>
      {resetDialogOpen ? (
        <PreferencesResetConfirmDialog
          busy={resetBusy}
          locale={locale}
          onCancel={() => {
            setResetDialogOpen(false);
          }}
          onConfirm={() => {
            void resetPreferencesToDefaults({
              state: props.state,
              setState: props.setState,
              setBusy: setResetBusy,
              setMessage: setResetMessage,
              setDialogOpen: setResetDialogOpen,
              locale
            });
          }}
        />
      ) : null}
    </div>
  );
}

function PreferencesResetConfirmDialog(props: {
  busy: boolean;
  locale: Locale;
  onCancel(): void;
  onConfirm(): void;
}): React.JSX.Element {
  return (
    <AppDialog
      ariaLabel={t(props.locale, 'preferencesResetConfirmTitle')}
      closeLabel={t(props.locale, 'dialogClose')}
      footer={({ requestClose }) => (
        <ActionButtons
          isPrimaryActionDisabled={props.busy}
          isSecondaryActionDisabled={props.busy}
          onPrimaryAction={() => {
            props.onConfirm();
          }}
          onSecondaryAction={requestClose}
          primaryActionText={t(props.locale, 'preferencesResetAction')}
          primaryVariant="default"
          secondaryActionText={t(props.locale, 'confirmCancelAction')}
          secondaryVariant="ghost"
          size="sm"
        />
      )}
      onClose={() => {
        props.onCancel();
      }}
      showCloseButton
      title={t(props.locale, 'preferencesResetConfirmTitle')}
    >
      <p>{t(props.locale, 'preferencesResetConfirmBody')}</p>
    </AppDialog>
  );
}

async function resetPreferencesToDefaults(input: {
  state: ChatAppState;
  setState: React.Dispatch<React.SetStateAction<ChatAppState>>;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setMessage: React.Dispatch<React.SetStateAction<string | null>>;
  setDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  locale: Locale;
}): Promise<void> {
  if (input.state.client === null) {
    return;
  }
  input.setBusy(true);
  input.setMessage(null);
  try {
    const next = await input.state.client.resetUiPreferences();
    input.setState((current) => ({
      ...current,
      preferences: {
        ...next,
        last_opened_conversation_id: current.preferences.last_opened_conversation_id
      }
    }));
    input.setDialogOpen(false);
    input.setMessage(t(input.locale, 'preferencesResetSuccess'));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : t(input.locale, 'operationRetryLater');
    input.setMessage(t(input.locale, 'preferencesResetError', { error: message }));
  } finally {
    input.setBusy(false);
  }
}
