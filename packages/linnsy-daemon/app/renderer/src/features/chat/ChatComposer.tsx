import React, { useLayoutEffect, useRef } from 'react';

import { t, type Locale } from '../../lib/i18n.js';
import { FluentIcon } from '../../components/FluentIcon.js';

export interface ChatComposerProps {
  canSend: boolean;
  disabled?: boolean;
  draft: string;
  locale: Locale;
  onDraftChange(value: string): void;
  onSend(): void;
  placeholder?: string;
}

export function ChatComposer(props: ChatComposerProps): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea === null) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${String(textarea.scrollHeight)}px`;
  }, [props.draft]);

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (!props.canSend) return;
        props.onSend();
      }}
    >
      <textarea
        aria-label={t(props.locale, 'composerInput')}
        disabled={props.disabled === true}
        onChange={(event) => {
          props.onDraftChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
            return;
          }
          event.preventDefault();
          if (props.canSend) {
            props.onSend();
          }
        }}
        placeholder={props.placeholder ?? t(props.locale, 'composerPlaceholder')}
        ref={textareaRef}
        rows={1}
        value={props.draft}
      />
      <div className="input-footer">
        <button aria-label={t(props.locale, 'composerSend')} className="send-btn" disabled={!props.canSend} type="submit">
          <FluentIcon aria-hidden="true" name="arrowUp" size={14} />
        </button>
      </div>
    </form>
  );
}
