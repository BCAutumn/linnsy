import React from 'react';

import type { ConversationSummary } from '../lib/daemon-api.js';
import { getConversationDisplayName } from '../lib/conversation-list.js';
import { t, type Locale } from '../lib/i18n.js';
import { ActionButtons } from '../components/ActionButtons.js';
import { AppDialog } from '../components/AppDialog.js';

export function DeleteConversationDialog(props: {
  conversation: ConversationSummary;
  locale: Locale;
  onClose: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  return (
    <AppDialog
      ariaLabel={t(props.locale, 'conversationDeleteConfirmTitle')}
      closeLabel={t(props.locale, 'dialogClose')}
      footer={({ requestClose }) => (
        <ActionButtons
          onPrimaryAction={props.onConfirm}
          onSecondaryAction={requestClose}
          primaryActionText={t(props.locale, 'confirmDeleteAction')}
          primaryVariant="danger"
          secondaryActionText={t(props.locale, 'confirmCancelAction')}
        />
      )}
      onClose={props.onClose}
      showCloseButton
      title={t(props.locale, 'conversationDeleteConfirmTitle')}
    >
      <p className="conv-delete-dialog-text">
        {t(props.locale, 'conversationDeleteConfirmBody', {
          title: getConversationDisplayName(props.conversation)
        })}
      </p>
    </AppDialog>
  );
}
