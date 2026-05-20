import React, { useState } from 'react';

import type { ConversationSummary } from '../lib/daemon-api.js';
import { getConversationDisplayName } from '../lib/conversation-list.js';
import { t, type Locale } from '../lib/i18n.js';
import { ActionButtons } from '../components/ActionButtons.js';
import { AppDialog } from '../components/AppDialog.js';
import { TextField } from '../components/TextField.js';

export function RenameConversationDialog(props: {
  conversation: ConversationSummary;
  locale: Locale;
  onClose: () => void;
  onSubmit: (title: string | null) => void;
}): React.JSX.Element {
  const [title, setTitle] = useState(props.conversation.title ?? getConversationDisplayName(props.conversation));
  const normalized = normalizeDialogTitle(title);

  return (
    <AppDialog
      ariaLabel={t(props.locale, 'conversationRenameDialogTitle')}
      className="conversation-rename-dialog"
      closeLabel={t(props.locale, 'dialogClose')}
      footer={({ requestClose }) => (
        <ActionButtons
          onPrimaryAction={() => {
            props.onSubmit(normalized);
          }}
          onSecondaryAction={requestClose}
          primaryActionText={t(props.locale, 'conversationRenameSave')}
          secondaryActionText={t(props.locale, 'confirmCancelAction')}
          size="sm"
        />
      )}
      onClose={props.onClose}
      showCloseButton
      title={t(props.locale, 'conversationRenameDialogTitle')}
    >
      <TextField
        autoComplete="off"
        className="conversation-rename-field"
        label={t(props.locale, 'conversationRenameFieldLabel')}
        onValueChange={setTitle}
        placeholder={t(props.locale, 'conversationRenamePlaceholder')}
        value={title}
      />
    </AppDialog>
  );
}

function normalizeDialogTitle(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length === 0 ? null : normalized;
}
