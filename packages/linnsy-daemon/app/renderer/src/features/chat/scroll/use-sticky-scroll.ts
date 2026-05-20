import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject
} from 'react';

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface UseStickyScrollOptions {
  watchKey: string;
  contentRef?: RefObject<HTMLElement>;
  resetKey?: string | null;
  thresholdPx?: number;
}

export interface StickyScrollBinding<T extends HTMLElement> {
  ref: RefObject<T>;
  onScroll: () => void;
  jumpToBottom: () => void;
  pauseAutoScrollForNextFrame: () => void;
  stuckToBottom: boolean;
}

const defaultBottomThresholdPx = 24;

export function distanceToBottom(metrics: ScrollMetrics): number {
  return Math.max(0, metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop);
}

export function isNearBottom(metrics: ScrollMetrics, thresholdPx = defaultBottomThresholdPx): boolean {
  return distanceToBottom(metrics) <= thresholdPx;
}

export function useStickyScroll<T extends HTMLElement>(
  options: UseStickyScrollOptions
): StickyScrollBinding<T> {
  const thresholdPx = options.thresholdPx ?? defaultBottomThresholdPx;
  const elementRef = useRef<T>(null);
  const shouldStickRef = useRef(true);
  const pausedAutoScrollFrameCountRef = useRef(0);
  const [stuckToBottom, setStuckToBottom] = useState(true);

  const updateStickyIntent = useCallback(() => {
    const element = elementRef.current;
    if (element === null) return;
    const next = isNearBottom(readScrollMetrics(element), thresholdPx);
    shouldStickRef.current = next;
    setStuckToBottom(next);
  }, [thresholdPx]);

  const scrollToBottomIfSticky = useCallback(() => {
    const element = elementRef.current;
    if (element === null || !shouldStickRef.current) return;
    if (pausedAutoScrollFrameCountRef.current > 0) {
      pausedAutoScrollFrameCountRef.current -= 1;
      return;
    }
    scrollToBottom(element);
  }, []);

  const pauseAutoScrollForNextFrame = useCallback(() => {
    pausedAutoScrollFrameCountRef.current = Math.max(pausedAutoScrollFrameCountRef.current, 1);
  }, []);

  const jumpToBottom = useCallback(() => {
    const element = elementRef.current;
    if (element === null) return;
    shouldStickRef.current = true;
    pausedAutoScrollFrameCountRef.current = 0;
    setStuckToBottom(true);
    scrollToBottom(element);
  }, []);

  useLayoutEffect(() => {
    shouldStickRef.current = true;
    pausedAutoScrollFrameCountRef.current = 0;
    setStuckToBottom(true);
    scrollToBottomIfSticky();
  }, [options.resetKey, scrollToBottomIfSticky]);

  useLayoutEffect(() => {
    scrollToBottomIfSticky();
  }, [options.watchKey, scrollToBottomIfSticky]);

  useEffect(() => {
    const element = elementRef.current;
    if (element === null || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      scrollToBottomIfSticky();
    });
    // S4.5：显式观察消息列表高度，绕过 reducer / React render 节流带来的贴底延迟。
    for (const target of collectResizeTargets(element, options.contentRef?.current ?? null)) {
      observer.observe(target);
    }
    return () => {
      observer.disconnect();
    };
  }, [options.contentRef, options.resetKey, scrollToBottomIfSticky]);

  return {
    ref: elementRef,
    onScroll: updateStickyIntent,
    jumpToBottom,
    pauseAutoScrollForNextFrame,
    stuckToBottom
  };
}

function readScrollMetrics(element: HTMLElement): ScrollMetrics {
  return {
    scrollTop: element.scrollTop,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight
  };
}

function scrollToBottom(element: HTMLElement): void {
  element.scrollTop = element.scrollHeight;
}

function collectResizeTargets(scrollElement: HTMLElement, contentElement: HTMLElement | null): HTMLElement[] {
  const targets = [scrollElement];
  if (contentElement !== null && contentElement !== scrollElement) {
    targets.push(contentElement);
  }
  return targets;
}
