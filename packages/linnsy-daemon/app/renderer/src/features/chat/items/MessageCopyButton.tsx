import React from 'react';

import { FluentIcon } from '../../../components/FluentIcon.js';
import { HoverTooltip } from '../../../components/HoverTooltip.js';
import { copyTextToClipboard } from '../../../lib/copy-to-clipboard.js';
import type { Locale } from '../../../lib/i18n.js';
import { t } from '../../../lib/i18n.js';

type CopyStatus = 'idle' | 'copied' | 'failed';

export function MessageCopyButton({
  locale,
  text
}: {
  locale: Locale;
  text: string;
}): React.JSX.Element | null {
  const [status, setStatus] = React.useState<CopyStatus>('idle');
  const resetTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    return () => {
      clearResetTimer(resetTimerRef.current);
    };
  }, []);

  if (text.trim().length === 0) {
    return null;
  }

  const tooltip = getCopyTooltip(locale, status);
  const iconName = status === 'copied' ? 'checkmark' : 'copy';

  return (
    <HoverTooltip text={tooltip} placement="top" offset={6}>
      <button
        type="button"
        className={`message-copy-button message-copy-button--${status}`}
        aria-label={tooltip}
        onClick={() => {
          void copyMessageText(text, setStatus, resetTimerRef);
        }}
      >
        <FluentIcon aria-hidden="true" name={iconName} size={14} />
      </button>
    </HoverTooltip>
  );
}

async function copyMessageText(
  text: string,
  setStatus: React.Dispatch<React.SetStateAction<CopyStatus>>,
  resetTimerRef: React.MutableRefObject<number | null>
): Promise<void> {
  clearResetTimer(resetTimerRef.current);
  try {
    await copyTextToClipboard(text);
    setStatus('copied');
  } catch (error) {
    console.warn('复制消息失败', error);
    setStatus('failed');
  }
  resetTimerRef.current = window.setTimeout(() => {
    setStatus('idle');
    resetTimerRef.current = null;
  }, 1600);
}

function clearResetTimer(timerId: number | null): void {
  if (timerId !== null) {
    window.clearTimeout(timerId);
  }
}

function getCopyTooltip(locale: Locale, status: CopyStatus): string {
  if (status === 'copied') {
    return t(locale, 'messageCopyCopied');
  }
  if (status === 'failed') {
    return t(locale, 'messageCopyFailed');
  }
  return t(locale, 'messageCopyAction');
}
