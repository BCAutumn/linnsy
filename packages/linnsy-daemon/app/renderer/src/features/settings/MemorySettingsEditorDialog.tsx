import React, { Suspense, lazy } from 'react';

import { t, type Locale } from '../../lib/i18n.js';
import { ActionButtons } from '../../components/ActionButtons.js';
import { AppDialog } from '../../components/AppDialog.js';
import { SegmentedControl } from '../../components/SegmentedControl.js';
import type { TiptapMarkdownEditorMode } from '../../components/TiptapMarkdownEditor.js';
import {
  countMemoryBodyUnits,
  getMemoryScopeLabelKey,
  MEMORY_BODY_UNIT_LIMIT,
  type MemoryItemDraft
} from './memory-settings.js';
import { MemoryScopeDescription } from './MemorySettingsPreview.js';

export type MemoryEditorMode = TiptapMarkdownEditorMode;

const TiptapMarkdownEditor = lazy(async () => {
  const module = await import('../../components/TiptapMarkdownEditor.js');
  return { default: module.TiptapMarkdownEditor };
});

export function MemorySettingsEditorDialog(props: {
  busy: boolean;
  draft: MemoryItemDraft;
  locale: Locale;
  mode: MemoryEditorMode;
  onChange: (draft: MemoryItemDraft) => void;
  onClose: () => void;
  onModeChange: (mode: MemoryEditorMode) => void;
  onSave: () => void;
}): React.JSX.Element {
  const modeOptions = [
    { value: 'markdown', label: t(props.locale, 'memoryModeMarkdown'), icon: 'code' },
    { value: 'wysiwyg', label: t(props.locale, 'memoryModeDocument'), icon: 'document' }
  ] satisfies ReadonlyArray<{
    value: MemoryEditorMode;
    label: string;
    icon: 'code' | 'document';
  }>;
  const bodyStats = countMemoryBodyUnits(props.draft.body);

  return (
    <AppDialog
      ariaLabel={t(props.locale, getMemoryScopeLabelKey(props.draft.scope))}
      backdropClassName="memory-dialog-backdrop"
      bodyClassName="memory-dialog-body"
      className="memory-dialog"
      footer={({ requestClose }) => (
        <ActionButtons
          isPrimaryActionDisabled={props.busy || bodyStats.isOverLimit}
          isSecondaryActionDisabled={props.busy}
          onPrimaryAction={props.onSave}
          onSecondaryAction={requestClose}
          primaryActionText={t(props.locale, 'memorySave')}
          secondaryActionText={t(props.locale, 'memoryCancel')}
          size="sm"
        />
      )}
      footerClassName="memory-dialog-footer"
      headerClassName="memory-dialog-header"
      headerEnd={<SegmentedControl ariaLabel={t(props.locale, 'memoryEditorMode')} onChange={props.onModeChange} options={modeOptions} size="sm" value={props.mode} />}
      onClose={props.onClose}
      size="lg"
      title={t(props.locale, getMemoryScopeLabelKey(props.draft.scope))}
    >
      <Suspense fallback={<div className="memory-tiptap-loading" />}>
        <TiptapMarkdownEditor
          ariaLabel={t(props.locale, getMemoryScopeLabelKey(props.draft.scope))}
          mode={props.mode}
          placeholder={t(props.locale, 'memoryEmpty')}
          toolbarLabels={{
            bold: t(props.locale, 'memoryToolbarBold'),
            bulletList: t(props.locale, 'memoryToolbarBulletList'),
            heading: t(props.locale, 'memoryToolbarHeading'),
            italic: t(props.locale, 'memoryToolbarItalic'),
            orderedList: t(props.locale, 'memoryToolbarOrderedList'),
            quote: t(props.locale, 'memoryToolbarQuote')
          }}
          value={props.draft.body}
          onChange={(body) => {
            props.onChange({ ...props.draft, body });
          }}
        />
      </Suspense>
      <div className="memory-dialog-under-card">
        <MemoryScopeDescription locale={props.locale} scope={props.draft.scope} variant="dialog" />
        <span
          aria-live="polite"
          className={`memory-body-stats${bodyStats.isOverLimit ? ' over-limit' : ''}`}
          title={bodyStats.isOverLimit ? t(props.locale, 'memoryBodyLimitExceeded') : undefined}
        >
          {t(props.locale, 'memoryBodyStats', {
            english: bodyStats.englishWords,
            han: bodyStats.hanCharacters,
            limit: MEMORY_BODY_UNIT_LIMIT
          })}
        </span>
      </div>
    </AppDialog>
  );
}
