// @vitest-environment happy-dom

import React, { useRef } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { useStickyScroll } from '../use-sticky-scroll.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class TestResizeObserver implements ResizeObserver {
  static instances: TestResizeObserver[] = [];

  readonly observedElements = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {
    TestResizeObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.observedElements.add(target);
  }

  unobserve(target: Element): void {
    this.observedElements.delete(target);
  }

  disconnect(): void {
    this.observedElements.clear();
  }

  trigger(): void {
    this.callback([], this);
  }
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let originalResizeObserver: typeof ResizeObserver | undefined;

beforeEach(() => {
  originalResizeObserver = globalThis.ResizeObserver;
  TestResizeObserver.instances = [];
  globalThis.ResizeObserver = TestResizeObserver;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  if (root !== null) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  container?.remove();
  container = null;
  if (originalResizeObserver === undefined) {
    Reflect.deleteProperty(globalThis, 'ResizeObserver');
  } else {
    globalThis.ResizeObserver = originalResizeObserver;
  }
});

describe('sticky scroll resize observer', () => {
  test('observes the message list and follows height growth without a watch key change', () => {
    renderHarness();
    const scrollElement = requireElement('.sticky-scroll-test');
    const messageList = requireElement('.sticky-scroll-test__messages');
    defineScrollMetrics(scrollElement, {
      clientHeight: 220,
      scrollHeight: () => 1_000
    });
    scrollElement.scrollTop = 780;

    const observer = requireObserver();
    expect(observer.observedElements.has(scrollElement)).toBe(true);
    expect(observer.observedElements.has(messageList)).toBe(true);

    defineScrollMetrics(scrollElement, {
      clientHeight: 220,
      scrollHeight: () => 1_240
    });
    act(() => {
      observer.trigger();
    });

    expect(scrollElement.scrollTop).toBe(1_240);
  });

  test('keeps the user position when scrolling upward has broken sticky intent', () => {
    renderHarness();
    const scrollElement = requireElement('.sticky-scroll-test');
    defineScrollMetrics(scrollElement, {
      clientHeight: 220,
      scrollHeight: () => 1_000
    });
    scrollElement.scrollTop = 500;

    act(() => {
      scrollElement.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    defineScrollMetrics(scrollElement, {
      clientHeight: 220,
      scrollHeight: () => 1_240
    });
    act(() => {
      requireObserver().trigger();
    });

    expect(scrollElement.scrollTop).toBe(500);
  });

  test('pauses one auto-scroll frame when an interactive card expands', () => {
    renderHarness();
    const scrollElement = requireElement('.sticky-scroll-test');
    defineScrollMetrics(scrollElement, {
      clientHeight: 220,
      scrollHeight: () => 1_000
    });
    scrollElement.scrollTop = 780;

    const expandButton = requireElement('.sticky-scroll-test__expand');
    act(() => {
      expandButton.click();
    });

    defineScrollMetrics(scrollElement, {
      clientHeight: 220,
      scrollHeight: () => 1_240
    });
    act(() => {
      requireObserver().trigger();
    });

    expect(scrollElement.scrollTop).toBe(780);

    defineScrollMetrics(scrollElement, {
      clientHeight: 220,
      scrollHeight: () => 1_300
    });
    act(() => {
      requireObserver().trigger();
    });

    expect(scrollElement.scrollTop).toBe(1_300);
  });

  test('lets the user explicitly jump back to bottom after sticky intent is broken', () => {
    renderHarness();
    const scrollElement = requireElement('.sticky-scroll-test');
    defineScrollMetrics(scrollElement, {
      clientHeight: 220,
      scrollHeight: () => 1_000
    });
    scrollElement.scrollTop = 500;

    act(() => {
      scrollElement.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    act(() => {
      requireElement('.sticky-scroll-test__jump').click();
    });

    expect(scrollElement.scrollTop).toBe(1_000);
    expect(requireElement('.sticky-scroll-test__stuck').textContent).toBe('stuck');
  });
});

function StickyScrollHarness(): React.JSX.Element {
  const messageListRef = useRef<HTMLElement>(null);
  const stickyScroll = useStickyScroll<HTMLDivElement>({
    contentRef: messageListRef,
    watchKey: 'stable'
  });

  return (
    <div className="sticky-scroll-test" onScroll={stickyScroll.onScroll} ref={stickyScroll.ref}>
      <button
        type="button"
        className="sticky-scroll-test__expand"
        onClick={stickyScroll.pauseAutoScrollForNextFrame}
      >
        展开工具卡
      </button>
      <button type="button" className="sticky-scroll-test__jump" onClick={stickyScroll.jumpToBottom}>
        回到底部
      </button>
      <span className="sticky-scroll-test__stuck">{stickyScroll.stuckToBottom ? 'stuck' : 'loose'}</span>
      <article className="sticky-scroll-test__messages" ref={messageListRef}>
        流式内容
      </article>
    </div>
  );
}

function renderHarness(): void {
  if (container === null) throw new Error('missing test container');
  root = createRoot(container);
  act(() => {
    root?.render(<StickyScrollHarness />);
  });
}

function requireElement(selector: string): HTMLElement {
  if (container === null) throw new Error('missing test container');
  const element = container.querySelector(selector);
  if (element === null) throw new Error(`missing element: ${selector}`);
  if (!(element instanceof HTMLElement)) throw new Error(`element is not HTMLElement: ${selector}`);
  return element;
}

function requireObserver(): TestResizeObserver {
  const observer = TestResizeObserver.instances[0];
  if (observer === undefined) throw new Error('missing ResizeObserver instance');
  return observer;
}

function defineScrollMetrics(
  element: HTMLElement,
  metrics: {
    clientHeight: number;
    scrollHeight: () => number;
  }
): void {
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    get: () => metrics.clientHeight
  });
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    get: metrics.scrollHeight
  });
}
