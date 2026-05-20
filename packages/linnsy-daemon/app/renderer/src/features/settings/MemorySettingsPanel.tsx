import React from 'react';

import type { DaemonApiClient } from '../../lib/daemon-api.js';
import { t, type Locale } from '../../lib/i18n.js';
import { isMemorySuccessMessage } from './memory-settings.js';
import { MemorySettingsEditorDialog } from './MemorySettingsEditorDialog.js';
import {
  MemoryPreviewCard,
  MemoryScopeSidebar,
  readPreviewBodyForScope
} from './MemorySettingsPreview.js';
import { useMemorySettingsPanel } from './use-memory-settings-panel.js';

export function MemorySettingsPanel(props: {
  client: DaemonApiClient | null;
  locale: Locale;
}): React.JSX.Element {
  const model = useMemorySettingsPanel({
    client: props.client,
    locale: props.locale
  });

  return (
    <div className="settings-stack memory-settings-root">
      <section className="settings-section">
        <header className="settings-section-header">
          <h3>{t(props.locale, 'memorySectionTitle')}</h3>
          <p>{t(props.locale, 'memorySectionDescription')}</p>
        </header>
        <div className="settings-section-body">
          <div className="memory-crud-grid">
            <MemoryScopeSidebar
              activeScope={model.selectedScope}
              locale={props.locale}
              onSelect={(scope) => {
                model.selectScope(scope);
              }}
            />
            <MemoryPreviewCard
              busy={model.busy}
              canPersist={props.client !== null && model.selectedItem !== null}
              draft={model.draft}
              item={model.selectedItem}
              locale={props.locale}
              previewBody={readPreviewBodyForScope({
                draft: model.draft,
                preview: model.systemPromptPreview
              })}
              onEdit={() => {
                model.editCurrentDraft();
              }}
              onToggleEnabled={(enabled) => {
                void model.toggleEnabled(enabled);
              }}
            />
          </div>
        </div>
      </section>
      {model.message === null ? null : (
        <p className={isMemorySuccessMessage(model.message, props.locale) ? 'field-success' : 'field-error'}>
          {model.message}
        </p>
      )}
      {model.modalDraft === null ? null : (
        <MemorySettingsEditorDialog
          busy={model.busy}
          draft={model.modalDraft}
          locale={props.locale}
          mode={model.editorMode}
          onChange={(draft) => {
            model.setModalDraft(draft);
          }}
          onClose={() => {
            model.closeEditor();
          }}
          onModeChange={(mode) => {
            model.setEditorMode(mode);
          }}
          onSave={() => {
            void model.saveDraft();
          }}
        />
      )}
    </div>
  );
}
