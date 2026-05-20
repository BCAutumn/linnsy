import React, { useEffect, useMemo, useState } from 'react';

import type {
  DaemonApiClient,
  ModelSettings,
  UserModelProviderType
} from '../../lib/daemon-api.js';
import {
  createEmptyUserModelDraft,
  modelOptionLabel,
  providerTypeLabel,
  removeUserModel,
  selectChatModelAfterUpsert,
  toUserModelDraft,
  toUserModelWriteInput,
  upsertUserModel,
  type UserModelDraft
} from './model-settings.js';
import { t, type Locale } from '../../lib/i18n.js';
import { CustomSelect, type CustomSelectOption } from '../../components/CustomSelect.js';
import { ActionButtons } from '../../components/ActionButtons.js';
import { AppDialog } from '../../components/AppDialog.js';
import { FluentIcon } from '../../components/FluentIcon.js';
import { SettingRow, SettingsSection } from './SettingsLayout.js';
import { TextField } from '../../components/TextField.js';

export function ModelSettingsPanel(props: {
  client: DaemonApiClient | null;
  locale: Locale;
}): React.JSX.Element {
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [draft, setDraft] = useState<UserModelDraft>(() => createEmptyUserModelDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isEditorOpen, setEditorOpen] = useState(false);
  const [isApiKeyVisible, setApiKeyVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const locale = props.locale;

  useEffect(() => {
    if (props.client === null) {
      return;
    }
    let mounted = true;
    props.client.getModelSettings()
      .then((next) => {
        if (mounted) setSettings(next);
      })
      .catch((error: unknown) => {
        if (mounted) setMessage(readErrorMessage(error, locale));
      });
    return () => {
      mounted = false;
    };
  }, [props.client, locale]);

  const chatModelOptions = useMemo<ReadonlyArray<CustomSelectOption<string>>>(() => {
    if (settings === null) {
      return [];
    }
    return settings.models.map((model) => ({
      value: model.id,
      text: modelOptionLabel(model)
    }));
  }, [settings]);

  if (props.client === null) {
    return <div className="placeholder-panel">{t(locale, 'modelDaemonUnavailable')}</div>;
  }
  const client = props.client;

  if (settings === null) {
    return <div className="placeholder-panel">{t(locale, 'modelLoading')}</div>;
  }

  const providerOptions: ReadonlyArray<CustomSelectOption<UserModelProviderType>> = [
    { value: 'openai_compatible', text: providerTypeLabel(locale, 'openai_compatible') },
    { value: 'anthropic_compatible', text: providerTypeLabel(locale, 'anthropic_compatible') }
  ];
  const draftModel = toUserModelWriteInput(draft);
  const closeEditor = (): void => {
    setDraft(createEmptyUserModelDraft());
    setEditingId(null);
    setEditorOpen(false);
    setApiKeyVisible(false);
    setMessage(null);
  };
  const openNewModelDialog = (): void => {
    setDraft(createEmptyUserModelDraft());
    setEditingId(null);
    setEditorOpen(true);
    setApiKeyVisible(false);
    setMessage(null);
  };

  return (
    <div className="settings-stack">
      <SettingsSection>
        <SettingRow label={t(locale, 'modelChatModel')} description={t(locale, 'modelChatModelDescription')}>
          <CustomSelect
            ariaLabel={t(locale, 'modelChatModel')}
            disabled={busy || settings.models.length === 0}
            fallbackPlaceholder={t(locale, 'customSelectPlaceholder')}
            fallbackTitle={t(locale, 'customSelectTitle')}
            minWidth="220px"
            onChange={(modelId) => {
              void saveSettings({
                client,
                settings,
                nextChatModelId: modelId,
                nextUserModels: settings.userModels,
                setBusy,
                setMessage,
                setSettings,
                locale
              });
            }}
            options={chatModelOptions}
            placeholder={t(locale, 'modelChatModelPlaceholder')}
            title={t(locale, 'modelChatModel')}
            value={settings.chatModelId ?? ''}
            width="260px"
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t(locale, 'modelListSectionTitle')}>
        <div className="model-list">
          {settings.models.map((model) => (
            <div className="model-list-row" key={model.id}>
              <div>
                <div className="field-label">{modelOptionLabel(model)}</div>
                {model.baseUrl === undefined ? null : <div className="field-desc">{model.baseUrl}</div>}
              </div>
              <div className="model-list-actions">
                <button
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => {
                    const userModel = settings.userModels.find((item) => `user.${item.id}` === model.id);
                    if (userModel !== undefined) {
                      setDraft(toUserModelDraft(userModel));
                      setEditingId(userModel.id);
                      setEditorOpen(true);
                      setApiKeyVisible(false);
                      setMessage(null);
                    }
                  }}
                  type="button"
                >
                  {t(locale, 'modelEdit')}
                </button>
                <button
                  className="btn ghost danger"
                  disabled={busy}
                  onClick={() => {
                    void deleteUserModel({
                      client,
                      settings,
                      userModelId: model.id.slice('user.'.length),
                      setBusy,
                      setMessage,
                      setSettings,
                      locale
                    });
                  }}
                  type="button"
                >
                  {t(locale, 'modelDelete')}
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="model-list-toolbar">
          <ActionButtons
            isPrimaryActionDisabled={busy}
            onPrimaryAction={openNewModelDialog}
            primaryActionText={t(locale, 'modelAdd')}
            showSecondaryAction={false}
            size="sm"
          />
        </div>
      </SettingsSection>
      {message === null ? null : <p className="field-error">{message}</p>}
      {isEditorOpen ? (
        <AppDialog
          ariaLabel={editingId === null ? t(locale, 'modelAddSectionTitle') : t(locale, 'modelEditSectionTitle')}
          bodyClassName="model-dialog-body"
          className="model-dialog"
          closeLabel={t(locale, 'dialogClose')}
          footer={({ requestClose }) => (
            <ActionButtons
              canPrimaryAction={draftModel !== null}
              isPrimaryActionDisabled={busy}
              isSecondaryActionDisabled={busy}
              onPrimaryAction={() => {
                if (draftModel === null) {
                  setMessage(t(locale, 'modelFormInvalid'));
                  return;
                }
                const nextUserModels = upsertUserModel(settings.userModels, draftModel);
                void saveSettings({
                  client,
                  settings,
                  nextChatModelId: selectChatModelAfterUpsert(settings.chatModelId, nextUserModels, draftModel.id),
                  nextUserModels,
                  setBusy,
                  setMessage,
                  setSettings,
                  locale,
                  afterSave: closeEditor
                });
              }}
              onSecondaryAction={requestClose}
              primaryActionText={editingId === null ? t(locale, 'modelAdd') : t(locale, 'modelSave')}
              secondaryActionText={t(locale, 'memoryCancel')}
              secondaryVariant="ghost"
              size="sm"
            />
          )}
          footerClassName="model-dialog-footer"
          onClose={closeEditor}
          showCloseButton
          title={editingId === null ? t(locale, 'modelAddSectionTitle') : t(locale, 'modelEditSectionTitle')}
        >
          <p className="model-dialog-description">
            {editingId === null ? t(locale, 'modelAddSectionDescription') : t(locale, 'modelEditSectionDescription')}
          </p>
          <div className="model-form-grid">
            <label className="model-provider-field">
              <span className="text-field-label">{t(locale, 'modelProviderType')}</span>
              <CustomSelect
                ariaLabel={t(locale, 'modelProviderType')}
                disabled={busy}
                minWidth="210px"
                onChange={(providerType) => {
                  setDraft((current) => ({ ...current, providerType }));
                }}
                options={providerOptions}
                title={t(locale, 'modelProviderType')}
                value={draft.providerType}
                width="100%"
              />
            </label>
            <TextField
              disabled={busy}
              label={t(locale, 'modelBaseUrl')}
              onValueChange={(baseUrl) => {
                setDraft((current) => ({ ...current, baseUrl }));
              }}
              placeholder="https://api.openai.com/v1"
              value={draft.baseUrl}
            />
            <TextField
              disabled={busy}
              label={t(locale, 'modelName')}
              onValueChange={(modelName) => {
                setDraft((current) => ({ ...current, modelName }));
              }}
              placeholder="gpt-4.1"
              value={draft.modelName}
            />
            <TextField
              autoComplete="off"
              disabled={busy}
              label={t(locale, 'modelApiKey')}
              onValueChange={(apiKey) => {
                setDraft((current) => ({ ...current, apiKey }));
              }}
              placeholder={draft.hasApiKey ? t(locale, 'modelApiKeySavedPlaceholder') : t(locale, 'modelApiKeyPlaceholder')}
              trailingAction={(
                <button
                  aria-label={isApiKeyVisible ? t(locale, 'modelApiKeyHide') : t(locale, 'modelApiKeyShow')}
                  className="text-field-icon-button"
                  onClick={() => {
                    setApiKeyVisible((current) => !current);
                  }}
                  title={isApiKeyVisible ? t(locale, 'modelApiKeyHide') : t(locale, 'modelApiKeyShow')}
                  type="button"
                >
                  <FluentIcon aria-hidden="true" name={isApiKeyVisible ? 'eyeOff' : 'eye'} size={16} />
                </button>
              )}
              type={isApiKeyVisible ? 'text' : 'password'}
              value={draft.apiKey}
            />
            <TextField
              disabled={busy}
              label={t(locale, 'modelDisplayName')}
              onValueChange={(displayName) => {
                setDraft((current) => ({ ...current, displayName }));
              }}
              placeholder={t(locale, 'modelDisplayNamePlaceholder')}
              value={draft.displayName}
            />
          </div>
        </AppDialog>
      ) : null}
    </div>
  );
}

async function saveSettings(input: {
  client: DaemonApiClient;
  settings: ModelSettings;
  nextChatModelId: string | null;
  nextUserModels: Parameters<DaemonApiClient['saveModelSettings']>[0]['userModels'];
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setMessage: React.Dispatch<React.SetStateAction<string | null>>;
  setSettings: React.Dispatch<React.SetStateAction<ModelSettings | null>>;
  locale: Locale;
  afterSave?: () => void;
}): Promise<void> {
  input.setBusy(true);
  input.setMessage(null);
  try {
    const next = await input.client.saveModelSettings({
      chatModelId: input.nextChatModelId,
      userModels: input.nextUserModels.map(stripModelSecretState)
    });
    input.setSettings(next);
    input.afterSave?.();
  } catch (error: unknown) {
    input.setMessage(readErrorMessage(error, input.locale));
  } finally {
    input.setBusy(false);
  }
}

function stripModelSecretState(
  model: Parameters<DaemonApiClient['saveModelSettings']>[0]['userModels'][number]
): Parameters<DaemonApiClient['saveModelSettings']>[0]['userModels'][number] {
  return {
    id: model.id,
    providerType: model.providerType,
    baseUrl: model.baseUrl,
    modelName: model.modelName,
    ...(model.displayName === undefined ? {} : { displayName: model.displayName }),
    ...(model.apiKey === undefined ? {} : { apiKey: model.apiKey }),
    ...(model.apiKeyEnv === undefined ? {} : { apiKeyEnv: model.apiKeyEnv })
  };
}

async function deleteUserModel(input: {
  client: DaemonApiClient;
  settings: ModelSettings;
  userModelId: string;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setMessage: React.Dispatch<React.SetStateAction<string | null>>;
  setSettings: React.Dispatch<React.SetStateAction<ModelSettings | null>>;
  locale: Locale;
}): Promise<void> {
  const next = removeUserModel(input.settings, input.userModelId);
  await saveSettings({
    client: input.client,
    settings: input.settings,
    nextChatModelId: next.chatModelId,
    nextUserModels: next.userModels,
    setBusy: input.setBusy,
    setMessage: input.setMessage,
    setSettings: input.setSettings,
    locale: input.locale
  });
}

function readErrorMessage(error: unknown, locale: Locale): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (isErrorBody(error)) {
    return error.message ?? error.code;
  }
  return t(locale, 'operationRetryLater');
}

function isErrorBody(value: unknown): value is { code: string; message?: string } {
  return typeof value === 'object'
    && value !== null
    && 'code' in value
    && typeof value.code === 'string';
}
