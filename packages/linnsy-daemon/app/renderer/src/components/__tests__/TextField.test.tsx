// @vitest-environment happy-dom

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, test } from 'vitest';

import { TextField } from '../TextField.js';

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

function render(node: React.ReactElement): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root?.render(node); });
  return container;
}

describe('TextField', () => {
  test('只有点击输入框本体才会聚焦', () => {
    const dom = render(
      <TextField
        label="对话名称"
        onValueChange={() => {}}
        value="常聊对话"
      />
    );
    const label = dom.querySelector('.text-field-label');
    const input = dom.querySelector('input');

    expect(label).toBeInstanceOf(HTMLSpanElement);
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect((input as HTMLInputElement).getAttribute('aria-label')).toBe('对话名称');

    (label as HTMLSpanElement).click();

    expect(document.activeElement).not.toBe(input);

    (input as HTMLInputElement).focus();

    expect(document.activeElement).toBe(input);
  });
});
