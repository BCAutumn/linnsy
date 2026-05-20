import React from 'react';

import type { MemoryItem, SystemPromptPreview } from '../../lib/daemon-api.js';
import { t, type Locale } from '../../lib/i18n.js';
import { ChatMarkdownView } from '../chat/markdown/ChatMarkdownView.js';
import { ScrollArea } from '../../components/ScrollArea.js';
import { ToggleSwitch } from '../../components/ToggleSwitch.js';
import {
  formatMemoryTime,
  getMemoryScopeDescriptionKey,
  MEMORY_SCOPE_OPTIONS,
  type MemoryItemDraft,
  type MemoryScopePreset
} from './memory-settings.js';

export function MemoryScopeSidebar(props: {
  activeScope: MemoryScopePreset;
  locale: Locale;
  onSelect: (scope: MemoryScopePreset) => void;
}): React.JSX.Element {
  return (
    <div className="memory-scope-sidebar" aria-label={t(props.locale, 'memoryScopeFilter')}>
      {MEMORY_SCOPE_OPTIONS.map((option) => (
        <button
          className={`memory-scope-button${option.scope === props.activeScope ? ' active' : ''}`}
          key={option.scope}
          onClick={() => {
            props.onSelect(option.scope);
          }}
          type="button"
        >
          {t(props.locale, option.labelKey)}
        </button>
      ))}
    </div>
  );
}

export function MemoryPreviewCard(props: {
  busy: boolean;
  canPersist: boolean;
  draft: MemoryItemDraft;
  item: MemoryItem | null;
  locale: Locale;
  previewBody: string;
  onEdit: () => void;
  onToggleEnabled: (enabled: boolean) => void;
}): React.JSX.Element {
  function openEditor(): void {
    if (props.busy) return;
    props.onEdit();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openEditor();
  }

  return (
    <div className="memory-editor-panel">
      <div
        aria-disabled={props.busy}
        aria-label={t(props.locale, 'memoryEditCurrent')}
        className={`memory-preview-card${props.busy ? ' disabled' : ''}`}
        onClick={openEditor}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={props.busy ? -1 : 0}
      >
        <ScrollArea className="memory-preview-scroll">
          <MemoryMarkdownPreview body={props.previewBody} locale={props.locale} />
        </ScrollArea>
      </div>
      <div className="memory-preview-footer">
        <MemoryScopeDescription locale={props.locale} scope={props.draft.scope} />
        <span aria-hidden="true" className="memory-edit-hint">{t(props.locale, 'memoryClickToEdit')}</span>
      </div>
      <MemoryScopeOptions
        canPersist={props.canPersist}
        disabled={props.busy}
        enabled={isMemoryDraftEnabled(props.draft)}
        locale={props.locale}
        onToggleEnabled={props.onToggleEnabled}
        scope={props.draft.scope}
      />
      <MemoryMeta item={props.item} locale={props.locale} />
    </div>
  );
}

export function readPreviewBodyForScope(input: {
  draft: MemoryItemDraft;
  preview: SystemPromptPreview | null;
}): string {
  if (input.preview === null) {
    return input.draft.body;
  }
  const section = input.preview.sections.find((candidate) => candidate.scope === input.draft.scope);
  return section?.body ?? input.draft.body;
}

export function MemoryScopeDescription(props: {
  locale: Locale;
  scope: string;
  variant?: 'dialog';
}): React.JSX.Element {
  const className = props.variant === 'dialog'
    ? 'memory-scope-description memory-scope-description--dialog'
    : 'memory-scope-description';
  return <p className={className}>{t(props.locale, getMemoryScopeDescriptionKey(props.scope))}</p>;
}

function MemoryMarkdownPreview(props: {
  body: string;
  locale: Locale;
}): React.JSX.Element {
  const trimmed = props.body.trim();
  if (trimmed.length === 0) {
    return <span className="memory-preview-empty">{t(props.locale, 'memoryEmpty')}</span>;
  }
  return <ChatMarkdownView content={props.body} />;
}

function MemoryScopeOptions(props: {
  canPersist: boolean;
  disabled: boolean;
  enabled: boolean;
  locale: Locale;
  onToggleEnabled: (enabled: boolean) => void;
  scope: string;
}): React.JSX.Element | null {
  if (!hasMemoryScopeOptions(props.scope)) {
    return null;
  }
  return (
    <div className="memory-scope-options">
      <MemoryScopeOptionRow label={t(props.locale, 'memoryOptionEnabled')}>
        <ToggleSwitch
          checked={props.enabled}
          disabled={props.disabled || !props.canPersist}
          label={t(props.locale, 'memoryOptionEnabled')}
          onChange={props.onToggleEnabled}
        />
      </MemoryScopeOptionRow>
      <MemoryScopeOptionRow label={t(props.locale, 'memoryOptionAutoExtract')}>
        <ToggleSwitch checked={false} disabled label={t(props.locale, 'memoryOptionAutoExtract')} onChange={noopToggleChange} />
      </MemoryScopeOptionRow>
    </div>
  );
}

function MemoryScopeOptionRow(props: {
  children: React.ReactNode;
  label: string;
}): React.JSX.Element {
  return (
    <div className="memory-scope-option-row">
      <span>{props.label}</span>
      {props.children}
    </div>
  );
}

function MemoryMeta(props: {
  item: MemoryItem | null;
  locale: Locale;
}): React.JSX.Element {
  return (
    <div className="memory-readonly-meta">
      <div>
        <span>{t(props.locale, 'memoryCreatedAt')}</span>
        <span className="memory-meta-value">{props.item === null ? '-' : formatMemoryTime(props.locale, props.item.createdAt)}</span>
      </div>
      <div>
        <span>{t(props.locale, 'memoryUpdatedAt')}</span>
        <span className="memory-meta-value">{props.item === null ? '-' : formatMemoryTime(props.locale, props.item.updatedAt)}</span>
      </div>
    </div>
  );
}

function noopToggleChange(checked: boolean): void {
  void checked;
}

function hasMemoryScopeOptions(scope: string): boolean {
  return scope === 'user_preference' || scope === 'long_term_memory';
}

function isMemoryDraftEnabled(draft: MemoryItemDraft): boolean {
  return draft.metadata?.enabled !== false;
}
