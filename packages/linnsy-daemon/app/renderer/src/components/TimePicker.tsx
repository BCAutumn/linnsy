import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { getLinnsyPortalRoot } from '../lib/linnsy-portal-host.js';
import type { Locale } from '../lib/i18n.js';
import { t } from '../lib/i18n.js';
import { ActionButtons } from './ActionButtons.js';
import { CustomSelect, type CustomSelectOption } from './CustomSelect.js';
import { useDisclosureTransition } from './use-disclosure-transition.js';

/** Portaled hour/minute lists share width; triggers stay compact. */
const TP_OPTIONS_LIST_WIDTH_PX = 52;

export function TimePicker(props: {
  value: string;
  onChange(value: string): void;
  locale: Locale;
  placeholder?: string;
  portal?: boolean;
  ariaLabel?: string;
}): React.JSX.Element {
  const triggerId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const tpSelectPortalHostRef = useRef<HTMLDivElement>(null);
  const popoverTransition = useDisclosureTransition();
  const [draftHour, setDraftHour] = useState('00');
  const [draftMinute, setDraftMinute] = useState('00');
  const [panelBox, setPanelBox] = useState<{ left: number; top: number } | null>(null);
  const { close: closePopover, isClosing, isOpen, isVisible: popoverVisible, toggle: togglePopover } = popoverTransition;

  const placeholder = props.placeholder ?? t(props.locale, 'timePickerPlaceholder');

  const hourOptions = useMemo(
    (): ReadonlyArray<CustomSelectOption<string>> => Array.from({ length: 24 }, (_, index) => {
      const value = String(index).padStart(2, '0');
      return { value, text: value };
    }),
    []
  );

  const minuteOptions = useMemo(
    (): ReadonlyArray<CustomSelectOption<string>> => Array.from({ length: 60 }, (_, index) => {
      const value = String(index).padStart(2, '0');
      return { value, text: value };
    }),
    []
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const parsed = parseHm(props.value);
    if (parsed === null) {
      const now = new Date();
      setDraftHour(String(now.getHours()).padStart(2, '0'));
      setDraftMinute(String(now.getMinutes()).padStart(2, '0'));
      return;
    }
    setDraftHour(parsed.hour);
    setDraftMinute(parsed.minute);
  }, [isOpen, props.value]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (target instanceof Element && target.closest('.custom-select-options') !== null) {
        return;
      }
      const root = rootRef.current;
      const popover = popoverRef.current;
      if (root?.contains(target) ?? false) {
        return;
      }
      if (popover?.contains(target) ?? false) {
        return;
      }
      closePopover();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [closePopover]);

  const syncPanelPosition = useCallback((): void => {
    const root = rootRef.current;
    if (root === null) {
      return;
    }
    const rect = root.getBoundingClientRect();
    const gap = 4;
    const pop = popoverRef.current;
    const measured = pop === null ? 0 : pop.getBoundingClientRect().width;
    const popoverWidth = measured > 16 ? measured : 172;
    setPanelBox({
      top: rect.bottom + gap,
      left: rect.right - popoverWidth
    });
  }, []);

  useLayoutEffect(() => {
    if (!popoverVisible || !props.portal) {
      setPanelBox(null);
      return;
    }
    syncPanelPosition();
    const raf = window.requestAnimationFrame(() => {
      syncPanelPosition();
    });
    window.addEventListener('scroll', syncPanelPosition, true);
    window.addEventListener('resize', syncPanelPosition);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('scroll', syncPanelPosition, true);
      window.removeEventListener('resize', syncPanelPosition);
    };
  }, [popoverVisible, props.portal, syncPanelPosition]);

  function applySelection(): void {
    props.onChange(`${draftHour}:${draftMinute}`);
    closePopover();
  }

  const displayTime = formatDisplayHm(props.value);

  const panelStyle: React.CSSProperties | undefined = !props.portal
    ? undefined
    : panelBox === null
      ? {
          position: 'fixed',
          visibility: 'hidden',
          left: 0,
          top: 0,
          zIndex: 60
        }
      : {
          position: 'fixed',
          left: panelBox.left,
          top: panelBox.top,
          zIndex: 60
        };

  const popoverEl = !popoverVisible ? null : (
    <div
      className={[
        'tp-popover',
        props.portal ? 'tp-popover--portal' : '',
        isClosing ? 'is-closing' : 'is-opening'
      ].filter(Boolean).join(' ')}
      id={`${triggerId}-popover`}
      ref={popoverRef}
      role="dialog"
      aria-label={props.ariaLabel ?? placeholder}
      style={panelStyle}
    >
      <div className="tp-popover-body">
        <div className="tp-select-row">
          <div className="tp-select-wrap tp-select-wrap--hour">
            <CustomSelect
              ariaLabel={t(props.locale, 'timePickerHour')}
              fallbackPlaceholder={t(props.locale, 'customSelectPlaceholder')}
              fallbackTitle={t(props.locale, 'timePickerHour')}
              minWidth="52px"
              options={hourOptions}
              optionsClassName="custom-select-options--time-scroll"
              optionsScrollbarVisibility="persistent"
              optionsWidth={TP_OPTIONS_LIST_WIDTH_PX}
              portal={true}
              portalAlign="start"
              portalMountRef={tpSelectPortalHostRef}
              portalPlacement="above"
              title={t(props.locale, 'timePickerHour')}
              value={draftHour}
              variant="minimal"
              width="auto"
              onChange={(value) => {
                setDraftHour(value);
              }}
            />
          </div>
          <span aria-hidden="true" className="tp-separator">
            :
          </span>
          <div className="tp-select-wrap tp-select-wrap--minute">
            <CustomSelect
              ariaLabel={t(props.locale, 'timePickerMinute')}
              fallbackPlaceholder={t(props.locale, 'customSelectPlaceholder')}
              fallbackTitle={t(props.locale, 'timePickerMinute')}
              minWidth="52px"
              options={minuteOptions}
              optionsClassName="custom-select-options--time-scroll"
              optionsScrollbarVisibility="persistent"
              optionsWidth={TP_OPTIONS_LIST_WIDTH_PX}
              portal={true}
              portalAlign="end"
              portalMountRef={tpSelectPortalHostRef}
              portalPlacement="above"
              title={t(props.locale, 'timePickerMinute')}
              value={draftMinute}
              variant="minimal"
              width="auto"
              onChange={(value) => {
                setDraftMinute(value);
              }}
            />
          </div>
        </div>
        <div aria-hidden className="tp-select-portal-host" ref={tpSelectPortalHostRef} />
      </div>
      <div className="tp-actions">
        <ActionButtons
          onPrimaryAction={applySelection}
          onSecondaryAction={closePopover}
          primaryActionText={t(props.locale, 'timePickerApply')}
          secondaryActionText={t(props.locale, 'confirmCancelAction')}
          showSecondaryAction={true}
          size="compact"
        />
      </div>
    </div>
  );

  return (
    <div className="tp-root" ref={rootRef}>
      <button
        aria-expanded={isOpen}
        aria-controls={isOpen ? `${triggerId}-popover` : undefined}
        aria-haspopup="dialog"
        className="tp-trigger"
        id={triggerId}
        type="button"
        onClick={togglePopover}
      >
        {displayTime.length === 0 ? placeholder : displayTime}
      </button>
      {popoverEl === null ? null : props.portal ? createPortal(popoverEl, getLinnsyPortalRoot(rootRef.current)) : popoverEl}
    </div>
  );
}

function parseHm(value: string): { hour: string; minute: string } | null {
  const trimmed = value.trim();
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/u.exec(trimmed);
  if (match === null) {
    return null;
  }
  const hour = match[1];
  const minute = match[2];
  if (hour === undefined || minute === undefined) {
    return null;
  }
  return { hour, minute };
}

function formatDisplayHm(value: string): string {
  const parsed = parseHm(value);
  return parsed === null ? '' : `${parsed.hour}:${parsed.minute}`;
}
