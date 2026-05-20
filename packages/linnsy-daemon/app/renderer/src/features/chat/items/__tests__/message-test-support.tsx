import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach } from 'vitest';
import type React from 'react';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  if (root !== null) {
    act(() => { root?.unmount(); });
  }
  root = null;
  container?.remove();
  container = null;
});

export function renderMessage(node: React.ReactElement): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root?.render(node); });
  return container;
}

export function rerenderMessage(node: React.ReactElement): void {
  act(() => { root?.render(node); });
}
