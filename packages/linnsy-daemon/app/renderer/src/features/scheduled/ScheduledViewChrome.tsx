import React, { useId, useState } from 'react';

import { ActionButtons } from '../../components/ActionButtons.js';
import { AppDialog } from '../../components/AppDialog.js';
import { FluentIcon } from '../../components/FluentIcon.js';
import { t, type Locale } from '../../lib/i18n.js';

export function PanelHeader(props: {
  action?: React.ReactNode;
  title: string;
}): React.JSX.Element {
  return (
    <header className="scheduled-view-panel-header">
      <div className="scheduled-view-panel-title">
        <h2>{props.title}</h2>
      </div>
      {props.action}
    </header>
  );
}

export function EmptyState(props: {
  icon: 'clock';
  text: string;
}): React.JSX.Element {
  return (
    <div className="scheduled-view-empty">
      <FluentIcon aria-hidden="true" name={props.icon} size={20} />
      <p>{props.text}</p>
    </div>
  );
}

export function ConfirmDialog(props: {
  body: string;
  locale: Locale;
  title: string;
  skipFutureOption?: {
    label: string;
    hint: string;
  };
  onCancel(): void;
  onConfirm(skipFuture: boolean): void;
}): React.JSX.Element {
  const [skipFuture, setSkipFuture] = useState(false);
  const skipFutureCheckboxId = useId();
  return (
    <AppDialog
      ariaLabel={props.title}
      closeLabel={t(props.locale, 'confirmCancelAction')}
      footer={({ requestClose }) => (
        <ActionButtons
          onPrimaryAction={() => {
            props.onConfirm(skipFuture);
          }}
          onSecondaryAction={requestClose}
          primaryActionText={t(props.locale, 'confirmDeleteAction')}
          primaryVariant="danger"
          secondaryActionText={t(props.locale, 'confirmCancelAction')}
          showSecondaryAction={true}
          size="sm"
        />
      )}
      onClose={() => {
        props.onCancel();
      }}
      showCloseButton={true}
      title={props.title}
    >
      <p>{props.body}</p>
      {props.skipFutureOption === undefined ? null : (
        <label className="scheduled-view-skip-future" htmlFor={skipFutureCheckboxId}>
          <input
            id={skipFutureCheckboxId}
            type="checkbox"
            checked={skipFuture}
            onChange={(event) => {
              setSkipFuture(event.currentTarget.checked);
            }}
          />
          <span>
            <span className="scheduled-view-skip-future-label">{props.skipFutureOption.label}</span>
            <span className="scheduled-view-skip-future-hint">{props.skipFutureOption.hint}</span>
          </span>
        </label>
      )}
    </AppDialog>
  );
}
