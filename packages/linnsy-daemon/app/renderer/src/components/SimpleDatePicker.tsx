import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { getLinnsyPortalRoot } from '../lib/linnsy-portal-host.js';
import type { Locale } from '../lib/i18n.js';
import { t } from '../lib/i18n.js';
import { FluentIcon } from './FluentIcon.js';
import { useDisclosureTransition } from './use-disclosure-transition.js';

type ViewMode = 'date' | 'monthYear';

export function SimpleDatePicker(props: {
  value: string;
  onChange(value: string): void;
  locale: Locale;
  placeholder?: string;
  /** Mount panel in themed portal + fixed position (e.g. inside `overflow: auto` dialogs). */
  portal?: boolean;
  ariaLabel?: string;
}): React.JSX.Element {
  const triggerId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelTransition = useDisclosureTransition();
  const [viewMode, setViewMode] = useState<ViewMode>('date');
  const [displayMonth, setDisplayMonth] = useState<Date>(() => parseMonthAnchor(props.value));
  const [panelBox, setPanelBox] = useState<{ left: number; top: number } | null>(null);
  const { close: closePanel, isClosing, isOpen, isVisible: panelVisible, toggle: togglePanel } = panelTransition;

  const placeholder = props.placeholder ?? t(props.locale, 'datePickerPlaceholder');

  useEffect(() => {
    const selected = parseLocalDate(props.value);
    if (selected !== null) {
      setDisplayMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
    }
  }, [props.value]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      const root = rootRef.current;
      const panel = panelRef.current;
      if (root?.contains(target) ?? false) {
        return;
      }
      if (panel?.contains(target) ?? false) {
        return;
      }
      closePanel();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [closePanel]);

  const syncPanelPosition = useCallback((): void => {
    const root = rootRef.current;
    if (root === null) {
      return;
    }
    const rect = root.getBoundingClientRect();
    const gap = 4;
    const panel = panelRef.current;
    const measured = panel === null ? 0 : panel.getBoundingClientRect().width;
    const panelWidth = measured > 16 ? measured : 248;
    setPanelBox({
      top: rect.bottom + gap,
      left: rect.right - panelWidth
    });
  }, []);

  useLayoutEffect(() => {
    if (!panelVisible || !props.portal) {
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
  }, [panelVisible, props.portal, syncPanelPosition, viewMode]);

  const monthLabels = useMemo(() => getMonthLabels(props.locale), [props.locale]);
  const weekdayLabels = useMemo(() => getWeekdayLabels(props.locale), [props.locale]);

  const currentYear = displayMonth.getFullYear();
  const currentMonth = displayMonth.getMonth();

  const displayValue = props.value.trim().length === 0 ? '' : props.value;

  const calendarCells = useMemo(
    () => buildCalendarCells(currentYear, currentMonth, props.value),
    [currentMonth, currentYear, props.value]
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setViewMode('date');
  }, [isOpen]);

  function toggleOpen(): void {
    togglePanel();
  }

  function goPrev(): void {
    if (viewMode === 'date') {
      setDisplayMonth(new Date(currentYear, currentMonth - 1, 1));
    } else {
      setDisplayMonth(new Date(currentYear - 1, currentMonth, 1));
    }
  }

  function goNext(): void {
    if (viewMode === 'date') {
      setDisplayMonth(new Date(currentYear, currentMonth + 1, 1));
    } else {
      setDisplayMonth(new Date(currentYear + 1, currentMonth, 1));
    }
  }

  function handleSelectDate(cellDate: Date): void {
    const y = cellDate.getFullYear();
    const m = String(cellDate.getMonth() + 1).padStart(2, '0');
    const d = String(cellDate.getDate()).padStart(2, '0');
    props.onChange(`${String(y)}-${m}-${d}`);
    closePanel();
  }

  function selectMonth(monthIndex: number): void {
    setDisplayMonth(new Date(currentYear, monthIndex, 1));
    setViewMode('date');
  }

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

  const panelEl = !panelVisible ? null : (
    <div
      className={[
        'sdp-panel',
        props.portal ? 'sdp-panel--portal' : '',
        isClosing ? 'is-closing' : 'is-opening'
      ].filter(Boolean).join(' ')}
      id={`${triggerId}-panel`}
      ref={panelRef}
      role="dialog"
      aria-label={props.ariaLabel ?? placeholder}
      style={panelStyle}
    >
      <div className="sdp-header">
        <button aria-label={t(props.locale, 'datePickerPrev')} className="sdp-nav-btn" type="button" onClick={goPrev}>
          <FluentIcon aria-hidden="true" name="chevronLeft" size={14} />
        </button>
        <div className="sdp-month-label">
          <button
            className="sdp-year-text"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setViewMode('monthYear');
            }}
          >
            {props.locale === 'zh-CN' ? `${String(currentYear)}${t(props.locale, 'datePickerYearSuffix')}` : String(currentYear)}
          </button>
          {viewMode === 'date' ? <span>{monthLabels[currentMonth]}</span> : null}
        </div>
        <button aria-label={t(props.locale, 'datePickerNext')} className="sdp-nav-btn" type="button" onClick={goNext}>
          <FluentIcon aria-hidden="true" name="chevronRight" size={14} />
        </button>
      </div>
      {viewMode === 'date' ? (
        <>
          <div className="sdp-weekdays">
            {weekdayLabels.map((w, idx) => (
              <span className="sdp-weekday" key={idx}>
                {w}
              </span>
            ))}
          </div>
          <div className="sdp-grid">
            {calendarCells.map((cell, idx) => (
              <button
                className={[
                  'sdp-cell',
                  cell.date === null ? 'is-empty' : '',
                  cell.isToday ? 'is-today' : '',
                  cell.isSelected ? 'is-selected' : '',
                  cell.date !== null && !cell.isCurrentMonth ? 'is-outside-month' : ''
                ].filter(Boolean).join(' ')}
                disabled={cell.date === null || !cell.isCurrentMonth}
                key={idx}
                type="button"
                onClick={() => {
                  if (cell.date !== null && cell.isCurrentMonth) {
                    handleSelectDate(cell.date);
                  }
                }}
              >
                {cell.date === null ? null : <span>{cell.date.getDate()}</span>}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="sdp-month-grid">
          {monthLabels.map((name, index) => (
            <button
              className={`sdp-month-item${index === currentMonth ? ' is-current-month' : ''}`}
              key={index}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                selectMonth(index);
              }}
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="sdp-root" ref={rootRef}>
      <button
        aria-expanded={isOpen}
        aria-controls={isOpen ? `${triggerId}-panel` : undefined}
        aria-haspopup="dialog"
        className="sdp-input"
        id={triggerId}
        type="button"
        onClick={toggleOpen}
      >
        <span className="sdp-input-value">{displayValue.length === 0 ? placeholder : displayValue}</span>
      </button>
      {panelEl === null ? null : props.portal ? createPortal(panelEl, getLinnsyPortalRoot(rootRef.current)) : panelEl}
    </div>
  );
}

interface CalendarCell {
  date: Date | null;
  isToday: boolean;
  isSelected: boolean;
  isCurrentMonth: boolean;
}

const today = new Date();

function buildCalendarCells(year: number, month: number, valueYmd: string): CalendarCell[] {
  const firstDayOfMonth = new Date(year, month, 1);
  const firstWeekday = firstDayOfMonth.getDay() || 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const selected = parseLocalDate(valueYmd);

  const cells: CalendarCell[] = [];

  function makeCell(date: Date, isCurrentMonth: boolean): CalendarCell {
    const isToday =
      date.getFullYear() === today.getFullYear()
      && date.getMonth() === today.getMonth()
      && date.getDate() === today.getDate();
    const isSelected =
      selected !== null
      && date.getFullYear() === selected.getFullYear()
      && date.getMonth() === selected.getMonth()
      && date.getDate() === selected.getDate();

    return { date, isToday, isSelected, isCurrentMonth };
  }

  for (let i = 1; i < firstWeekday; i += 1) {
    const offset = firstWeekday - i;
    cells.push(makeCell(new Date(year, month, 1 - offset), false));
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(makeCell(new Date(year, month, day), true));
  }

  const TOTAL_SLOTS = 42;
  const remaining = TOTAL_SLOTS - cells.length;
  for (let i = 1; i <= remaining; i += 1) {
    cells.push(makeCell(new Date(year, month + 1, i), false));
  }

  return cells;
}

function parseMonthAnchor(valueYmd: string): Date {
  const parsed = parseLocalDate(valueYmd);
  if (parsed === null) {
    return new Date(today.getFullYear(), today.getMonth(), 1);
  }
  return new Date(parsed.getFullYear(), parsed.getMonth(), 1);
}

function parseLocalDate(valueYmd: string): Date | null {
  const trimmed = valueYmd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(trimmed)) {
    return null;
  }
  const [ys, ms, ds] = trimmed.split('-');
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return null;
  }
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return null;
  }
  return date;
}

function getMonthLabels(locale: Locale): string[] {
  const tag = locale === 'zh-CN' ? 'zh-CN' : 'en-US';
  return Array.from({ length: 12 }, (_, monthIndex) => {
    if (locale === 'zh-CN') {
      return `${String(monthIndex + 1)} 月`;
    }
    return new Intl.DateTimeFormat(tag, { month: 'short' }).format(new Date(2000, monthIndex, 1));
  });
}

function getWeekdayLabels(locale: Locale): string[] {
  const tag = locale === 'zh-CN' ? 'zh-CN' : 'en-US';
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(2024, 0, 1 + i);
    return new Intl.DateTimeFormat(tag, { weekday: 'narrow' }).format(d);
  });
}
