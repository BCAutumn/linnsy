import { useCallback, useLayoutEffect, type RefObject } from 'react';

export interface ChatScrollClipMetrics {
  clientHeight: number;
  clipEntryDepth: number;
  composerHeight: number;
  messageListHeight: number;
  scrollTop: number;
}

export interface UseChatScrollClipOptions {
  composerRef: RefObject<HTMLElement>;
  messageListRef: RefObject<HTMLElement>;
  resetKey?: string | null;
  scrollRef: RefObject<HTMLElement>;
  watchKey: string;
}

export interface ChatScrollClipBinding {
  updateClip(): void;
}

const messageListClipBottomVariable = '--message-list-clip-bottom';
const messageListClipEntryDepthVariable = '--message-list-clip-entry-depth';

export function calculateMessageListClipBottom(metrics: ChatScrollClipMetrics): number {
  const visibleMessageBottom = metrics.scrollTop + metrics.clientHeight - metrics.composerHeight + metrics.clipEntryDepth;
  return Math.max(0, metrics.messageListHeight - visibleMessageBottom);
}

export function useChatScrollClip(options: UseChatScrollClipOptions): ChatScrollClipBinding {
  const updateClip = useCallback(() => {
    const scrollElement = options.scrollRef.current;
    const messageList = options.messageListRef.current;
    const composer = options.composerRef.current;
    if (scrollElement === null || messageList === null || composer === null) return;

    const clipBottom = calculateMessageListClipBottom({
      clientHeight: scrollElement.clientHeight,
      clipEntryDepth: readPixelCustomProperty(messageList, messageListClipEntryDepthVariable),
      composerHeight: composer.getBoundingClientRect().height,
      messageListHeight: messageList.offsetHeight,
      scrollTop: scrollElement.scrollTop
    });
    messageList.style.setProperty(messageListClipBottomVariable, `${String(clipBottom)}px`);
  }, [options.composerRef, options.messageListRef, options.scrollRef]);

  useLayoutEffect(() => {
    updateClip();
  }, [options.resetKey, options.watchKey, updateClip]);

  useLayoutEffect(() => {
    const scrollElement = options.scrollRef.current;
    const messageList = options.messageListRef.current;
    const composer = options.composerRef.current;
    if (
      scrollElement === null ||
      messageList === null ||
      composer === null ||
      typeof ResizeObserver === 'undefined'
    ) {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      updateClip();
    });
    observer.observe(scrollElement);
    observer.observe(messageList);
    observer.observe(composer);
    return () => {
      observer.disconnect();
    };
  }, [options.composerRef, options.messageListRef, options.resetKey, options.scrollRef, updateClip]);

  return { updateClip };
}

function readPixelCustomProperty(element: HTMLElement, propertyName: string): number {
  const rawValue = getComputedStyle(element).getPropertyValue(propertyName).trim();
  const parsedValue = Number.parseFloat(rawValue);
  return Number.isFinite(parsedValue) ? Math.max(0, parsedValue) : 0;
}
