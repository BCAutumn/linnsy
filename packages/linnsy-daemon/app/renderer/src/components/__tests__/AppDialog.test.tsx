// @vitest-environment happy-dom

import React, { useState } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppDialog } from '../AppDialog.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('AppDialog', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('keeps the dialog mounted while the close animation plays', async () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    function Harness(): React.JSX.Element | null {
      const [open, setOpen] = useState(true);
      if (!open) {
        return null;
      }
      return (
        <AppDialog
          ariaLabel="测试弹窗"
          footer={({ requestClose }) => (
            <button onClick={requestClose} type="button">取消</button>
          )}
          onClose={() => {
            setOpen(false);
          }}
          title="测试弹窗"
        >
          <p>内容</p>
        </AppDialog>
      );
    }

    act(() => {
      root.render(<Harness />);
    });

    const button = container.querySelector<HTMLButtonElement>('button');
    if (button === null) {
      throw new Error('dialog cancel button should render');
    }

    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('.app-dialog--closing')).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(160);
    });

    expect(container.querySelector('.app-dialog')).toBeNull();
  });
});
