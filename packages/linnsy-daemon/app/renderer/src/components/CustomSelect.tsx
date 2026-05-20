import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { getLinnsyPortalRoot } from '../lib/linnsy-portal-host.js';
import { FluentIcon } from './FluentIcon.js';
import { ScrollArea, type ScrollAreaScrollbarVisibility } from './ScrollArea.js';
import {
  findFirstSelectableIndex,
  findNextSelectableIndex,
  findOptionByValue,
  findSelectedIndex,
  isSelectableOption,
  renderOption,
  resolveCssPx
} from './CustomSelectOptions.js';
import type { CustomSelectOption } from './custom-select-types.js';
export type { CustomSelectOption } from './custom-select-types.js';

export function CustomSelect<T extends string>(props: {
  value: T;
  options: ReadonlyArray<CustomSelectOption<T>>;
  placeholder?: string;
  title?: string;
  fallbackTitle?: string;
  fallbackPlaceholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  minWidth?: string;
  width?: string;
  variant?: 'default' | 'minimal';
  /** Render the options panel outside the DOM subtree with fixed positioning (e.g. inside overflow dialogs). Host is `.linnsy-window` when present so theme tokens inherit; otherwise `document.body`. */
  portal?: boolean;
  /** Appended to the options listbox element (works with `portal`). */
  optionsClassName?: string;
  /** Use the shared ScrollArea behavior for the options panel. */
  optionsScrollbarVisibility?: ScrollAreaScrollbarVisibility;
  /** Minimum width of the options panel (esp. when portaled width tracks a narrow trigger). */
  optionsMinWidth?: number | string;
  /** Fixed width for the portaled panel (defaults to trigger width). Use with TimePicker so hour/minute lists match. */
  optionsWidth?: number | string;
  /** Portaled panel opens above the trigger (avoids covering UI below, e.g. dialog buttons). */
  portalPlacement?: 'below' | 'above';
  /** Align portaled panel to trigger start (left) or end (right) edge. */
  portalAlign?: 'start' | 'end';
  /**
   * When set with portal=true, the list renders inside this node (e.g. a layer inside TimePicker popover).
   * Uses position:absolute relative to this subtree so sibling footer buttons can stack above the list (see `.tp-actions`).
   */
  portalMountRef?: React.RefObject<HTMLElement | null>;
  onChange(value: T): void;
}): React.JSX.Element {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [scopedPortalEl, setScopedPortalEl] = useState<HTMLElement | null>(null);
  const [portalLayout, setPortalLayout] = useState<{
    bottom?: number;
    left: number;
    top?: number;
    width: number;
  } | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [keyboardIndex, setKeyboardIndex] = useState(() => findFirstSelectableIndex(props.options));
  const selectedOption = useMemo(
    () => findOptionByValue(props.options, props.value),
    [props.options, props.value]
  );
  const displayValue = selectedOption?.text ?? props.placeholder ?? props.fallbackPlaceholder ?? '';
  const triggerTitle = selectedOption === undefined
    ? props.title ?? props.placeholder ?? props.fallbackTitle
    : `${props.title ?? props.fallbackTitle ?? ''}: ${selectedOption.text}`;
  const panelVisible = isOpen || isClosing;

  const clearCloseTimer = useCallback((): void => {
    if (closeTimerRef.current === null) {
      return;
    }
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const openDropdown = useCallback((): void => {
    clearCloseTimer();
    setIsClosing(false);
    setIsOpen(true);
  }, [clearCloseTimer]);

  const closeDropdown = useCallback((): void => {
    if (!isOpen) {
      return;
    }
    clearCloseTimer();
    setIsOpen(false);
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      setIsClosing(false);
      closeTimerRef.current = null;
    }, 150);
  }, [clearCloseTimer, isOpen]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      const root = rootRef.current;
      const panel = optionsRef.current;
      if (root?.contains(target) ?? false) {
        return;
      }
      if (panel?.contains(target) ?? false) {
        return;
      }
      closeDropdown();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [closeDropdown]);

  useLayoutEffect(() => {
    if (!props.portal || !panelVisible) {
      setScopedPortalEl(null);
      setPortalLayout(null);
      return;
    }

    const anchorFromRef = props.portalMountRef !== undefined ? props.portalMountRef.current : null;
    setScopedPortalEl(props.portalMountRef !== undefined ? anchorFromRef : null);

    const gapPx = 5;
    const placement = props.portalPlacement ?? 'below';

    const sync = (): void => {
      const root = rootRef.current;
      if (root === null) {
        return;
      }
      const rect = root.getBoundingClientRect();
      const minFromProp =
        props.optionsMinWidth === undefined ? 0 : resolveCssPx(props.optionsMinWidth, 0);
      const explicitW =
        props.optionsWidth === undefined ? null : resolveCssPx(props.optionsWidth, rect.width);
      const panelWidth =
        explicitW !== null
          ? Math.max(explicitW, minFromProp)
          : Math.max(rect.width, minFromProp);
      const alignEnd = props.portalAlign === 'end';
      const rawLeftViewport = alignEnd ? rect.right - panelWidth : rect.left;

      const scopedAnchor = props.portalMountRef !== undefined ? props.portalMountRef.current : null;

      if (scopedAnchor !== null) {
        const anchorRect = scopedAnchor.getBoundingClientRect();
        const margin = 4;
        let left = rawLeftViewport - anchorRect.left;
        left = Math.min(Math.max(margin, left), anchorRect.width - panelWidth - margin);
        if (placement === 'above') {
          const ty = rect.top - anchorRect.top;
          const bottom = anchorRect.height - ty + gapPx;
          setPortalLayout({ bottom, left, width: panelWidth });
        } else {
          const top = rect.bottom - anchorRect.top + gapPx;
          setPortalLayout({ left, top, width: panelWidth });
        }
        return;
      }

      const margin = 8;
      const left = Math.min(Math.max(margin, rawLeftViewport), window.innerWidth - panelWidth - margin);

      if (placement === 'above') {
        const bottom = window.innerHeight - rect.top + gapPx;
        setPortalLayout({ bottom, left, width: panelWidth });
      } else {
        const top = rect.bottom + gapPx;
        setPortalLayout({ left, top, width: panelWidth });
      }
    };

    sync();
    window.addEventListener('scroll', sync, true);
    window.addEventListener('resize', sync);
    return () => {
      window.removeEventListener('scroll', sync, true);
      window.removeEventListener('resize', sync);
    };
  }, [
    panelVisible,
    props.portal,
    props.portalPlacement,
    props.portalAlign,
    props.optionsWidth,
    props.optionsMinWidth,
    props.portalMountRef
  ]);

  useEffect(() => () => {
    clearCloseTimer();
  }, [clearCloseTimer]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const selectedIndex = findSelectedIndex(props.options, props.value);
    setKeyboardIndex(selectedIndex === -1 ? findFirstSelectableIndex(props.options) : selectedIndex);
  }, [isOpen, props.options, props.value]);

  useEffect(() => {
    if (!isOpen || keyboardIndex === -1) {
      return;
    }
    const selected = optionsRef.current?.querySelector<HTMLElement>(`[data-option-index="${String(keyboardIndex)}"]`);
    selected?.scrollIntoView({ block: 'nearest' });
  }, [isOpen, keyboardIndex]);

  const chooseOption = (option: CustomSelectOption<T>): void => {
    if (!isSelectableOption(option)) {
      return;
    }
    props.onChange(option.value);
    closeDropdown();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (props.disabled) {
      return;
    }
    if (event.key === 'Escape') {
      closeDropdown();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      openDropdown();
      setKeyboardIndex((current) => findNextSelectableIndex(props.options, current, direction));
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!isOpen) {
        openDropdown();
        return;
      }
      const option = props.options[keyboardIndex];
      if (option !== undefined) {
        chooseOption(option);
      }
    }
  };

  const optionsMinStyle: React.CSSProperties =
    props.optionsMinWidth === undefined
      ? {}
      : {
          minWidth: typeof props.optionsMinWidth === 'number' ? `${String(props.optionsMinWidth)}px` : props.optionsMinWidth
        };

  const portalVerticalStyle: React.CSSProperties =
    portalLayout !== null && portalLayout.bottom !== undefined
      ? { bottom: portalLayout.bottom, top: 'auto' }
      : portalLayout !== null && portalLayout.top !== undefined
        ? { top: portalLayout.top, bottom: 'auto' }
        : { top: 0, bottom: 'auto' };

  const usesScopedPortal = props.portalMountRef !== undefined;
  const portalPositionedInsideMount = usesScopedPortal && scopedPortalEl !== null;

  const portalPanelStyle: React.CSSProperties | undefined = props.portal && portalLayout !== null
    ? portalPositionedInsideMount
      ? {
          position: 'absolute',
          left: portalLayout.left,
          width: portalLayout.width,
          zIndex: 3,
          pointerEvents: 'auto',
          ...portalVerticalStyle,
          ...optionsMinStyle
        }
      : {
          position: 'fixed',
          left: portalLayout.left,
          width: portalLayout.width,
          zIndex: 60,
          ...portalVerticalStyle,
          ...optionsMinStyle
        }
    : props.portal
      ? {
          position: 'fixed',
          visibility: 'hidden',
          left: 0,
          top: 0,
          width: 0,
          pointerEvents: 'none',
          zIndex: 60,
          ...optionsMinStyle
        }
      : undefined;

  const optionsPanelStyle = props.portal ? portalPanelStyle : props.optionsMinWidth === undefined ? undefined : optionsMinStyle;

  const optionsClassNames = [
    'custom-select-options',
    props.portal ? 'custom-select-options--portal' : '',
    props.portal && props.portalPlacement === 'above' ? 'custom-select-options--portal-above' : '',
    props.optionsClassName,
    isClosing ? 'is-closing' : 'is-opening'
  ].filter(Boolean).join(' ');

  const optionsPanel = panelVisible ? (
    props.optionsScrollbarVisibility === undefined ? (
      <div
        aria-label={props.title}
        className={optionsClassNames}
        id={listboxId}
        ref={optionsRef}
        role="listbox"
        style={optionsPanelStyle}
      >
        {props.options.map((option, index) => renderOption({
          index,
          isKeyboardSelected: index === keyboardIndex,
          isSelected: isSelectableOption(option) && option.value === props.value,
          onChoose: chooseOption,
          onHover: setKeyboardIndex,
          option
        }))}
      </div>
    ) : (
      <ScrollArea
        aria-label={props.title}
        as="div"
        className={optionsClassNames}
        id={listboxId}
        ref={optionsRef}
        role="listbox"
        scrollbarVisibility={props.optionsScrollbarVisibility}
        style={optionsPanelStyle}
      >
        {props.options.map((option, index) => renderOption({
          index,
          isKeyboardSelected: index === keyboardIndex,
          isSelected: isSelectableOption(option) && option.value === props.value,
          onChoose: chooseOption,
          onHover: setKeyboardIndex,
          option
        }))}
      </ScrollArea>
    )
  ) : null;

  return (
    <div
      className={`custom-select custom-select--${props.variant ?? 'default'}`}
      ref={rootRef}
      style={{ minWidth: props.minWidth, width: props.width }}
    >
      <button
        aria-expanded={isOpen}
        aria-controls={panelVisible ? listboxId : undefined}
        aria-haspopup="listbox"
        aria-label={props.ariaLabel ?? props.title}
        className="custom-select-trigger"
        disabled={props.disabled}
        onClick={() => {
          if (isOpen) {
            closeDropdown();
          } else {
            openDropdown();
          }
        }}
        onKeyDown={handleKeyDown}
        title={triggerTitle}
        type="button"
      >
        <span className="custom-select-value">{displayValue}</span>
        <FluentIcon aria-hidden="true" className="custom-select-arrow" name="chevronRight" size={14} />
      </button>
      {!props.portal
        ? optionsPanel
        : optionsPanel !== null && (!usesScopedPortal || scopedPortalEl !== null)
          ? ((): ReturnType<typeof createPortal> | null => {
              const target = usesScopedPortal ? scopedPortalEl : getLinnsyPortalRoot(rootRef.current);
              return target === null ? null : createPortal(optionsPanel, target);
            })()
          : null}
    </div>
  );
}
