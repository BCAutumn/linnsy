import React from 'react';

import type { AssistantBubbleItem } from '../projection/types.js';
import { ChatMarkdownView } from '../markdown/ChatMarkdownView.js';
import type { Locale } from '../../../lib/i18n.js';
import { t } from '../../../lib/i18n.js';
import { FluentIcon } from '../../../components/FluentIcon.js';
import { getAssistantThoughtSummary } from './assistant-thought-display.js';
import { MessageCopyButton } from './MessageCopyButton.js';

export function AssistantBubble({
  copyText,
  entryClassName,
  item,
  locale
}: { copyText?: string; entryClassName: string; item: AssistantBubbleItem; locale: Locale }): React.JSX.Element {
  const hasThought = item.thoughtChunks.length > 0;
  const isThoughtOnly = hasThought && item.text.length === 0;
  const hasAnswerText = item.text.length > 0;
  // 只有纯思考段时不渲染正文 Markdown 空壳，避免占出一条普通 assistant 消息的空间。
  const shouldRenderAnswer = hasAnswerText || (!hasThought && item.streaming);
  const thoughtOnlyClassName = isThoughtOnly ? ' message--thought-only' : '';
  const [thoughtExpanded, setThoughtExpanded] = React.useState(() => item.text.length === 0);
  const thoughtSummary = getAssistantThoughtSummary(item, locale);
  const hadAnswerTextRef = React.useRef(hasAnswerText);

  React.useEffect(() => {
    if (!hadAnswerTextRef.current && hasAnswerText) {
      setThoughtExpanded(false);
    }
    hadAnswerTextRef.current = hasAnswerText;
  }, [hasAnswerText]);

  return (
    <div className={`message assistant msg${entryClassName}${thoughtOnlyClassName}`} data-item-id={item.id}>
      <div className="message-content">
        {hasThought
          ? (
              <section className="assistant-thought" aria-label={t(locale, 'assistantThoughtLabel')}>
                <button
                  type="button"
                  className={`assistant-thought__toggle${thoughtExpanded ? ' assistant-thought__toggle--expanded' : ''}`}
                  aria-expanded={thoughtExpanded}
                  aria-label={`${thoughtSummary.label}, ${thoughtExpanded ? t(locale, 'assistantThoughtCollapse') : t(locale, 'assistantThoughtExpand')}`}
                  onClick={() => {
                    setThoughtExpanded((expanded) => !expanded);
                  }}
                >
                  <FluentIcon name="chevronRight" size={14} className="assistant-thought__chevron" />
                  <span className="assistant-thought__summary">{thoughtSummary.label}</span>
                </button>
                {thoughtExpanded
                  ? (
                      <div className="assistant-thought__body">
                        {item.thoughtChunks.map((thought) => (
                          <div className="assistant-thought__chunk" key={thought.id}>
                            <ChatMarkdownView content={thought.text} streaming={!thought.completed} />
                          </div>
                        ))}
                      </div>
                    )
                  : null}
              </section>
            )
          : null}
        {shouldRenderAnswer
          ? <ChatMarkdownView content={item.text} showStreamingCursor={item.streaming} streaming={item.streaming} />
          : null}
        {copyText !== undefined
          ? (
              <div className="message-actions">
                <MessageCopyButton locale={locale} text={copyText} />
              </div>
            )
          : null}
      </div>
    </div>
  );
}
