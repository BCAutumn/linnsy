import React from 'react';

import type { UserBubbleItem } from '../projection/types.js';
import { ChatMarkdownView } from '../markdown/ChatMarkdownView.js';
import type { Locale } from '../../../lib/i18n.js';
import { MessageCopyButton } from './MessageCopyButton.js';

export function UserBubble({
  entryClassName,
  item,
  locale
}: { entryClassName: string; item: UserBubbleItem; locale: Locale }): React.JSX.Element {
  return (
    <div className={`message user msg${entryClassName}`} data-item-id={item.id}>
      <div className="message-content">
        <div className="bubble">
          <ChatMarkdownView content={item.text} streaming={false} />
        </div>
        <div className="message-actions">
          <MessageCopyButton locale={locale} text={item.text} />
        </div>
      </div>
    </div>
  );
}
