import React, { useCallback, useEffect, useId, useRef } from 'react';

import type { Locale } from '../lib/i18n.js';
import { t } from '../lib/i18n.js';
import { FluentIcon } from './FluentIcon.js';

function NumberSpinButtons(props: {
  isStepUpDisabled: boolean;
  isStepDownDisabled: boolean;
  locale: Locale;
  onStepDown(): void;
  onStepUp(): void;
  tabIndex?: number;
}): React.JSX.Element {
  const timeoutRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const stopRepeat = useCallback((): void => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    stopRepeat();
  }, [stopRepeat]);

  function startRepeat(direction: 'down' | 'up'): void {
    stopRepeat();
    timeoutRef.current = window.setTimeout(() => {
      intervalRef.current = window.setInterval(() => {
        const current = propsRef.current;
        if (direction === 'up' && current.isStepUpDisabled) {
          stopRepeat();
          return;
        }
        if (direction === 'down' && current.isStepDownDisabled) {
          stopRepeat();
          return;
        }
        if (direction === 'up') {
          current.onStepUp();
        } else {
          current.onStepDown();
        }
      }, 50);
    }, 300);
  }

  const tabIndex = props.tabIndex ?? -1;

  return (
    <div className="custom-num-spin-stack">
      <button
        aria-label={t(props.locale, 'numberInputIncrease')}
        className="custom-num-spin-btn custom-num-spin-btn--up"
        disabled={props.isStepUpDisabled}
        tabIndex={tabIndex}
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          props.onStepUp();
        }}
        onMouseDown={(event) => {
          if (event.button !== 0) {
            return;
          }
          startRepeat('up');
        }}
        onMouseLeave={stopRepeat}
        onMouseUp={stopRepeat}
      >
        <FluentIcon aria-hidden="true" name="chevronRight" size={11} />
      </button>
      <button
        aria-label={t(props.locale, 'numberInputDecrease')}
        className="custom-num-spin-btn custom-num-spin-btn--down"
        disabled={props.isStepDownDisabled}
        tabIndex={tabIndex}
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          props.onStepDown();
        }}
        onMouseDown={(event) => {
          if (event.button !== 0) {
            return;
          }
          startRepeat('down');
        }}
        onMouseLeave={stopRepeat}
        onMouseUp={stopRepeat}
      >
        <FluentIcon aria-hidden="true" name="chevronRight" size={11} />
      </button>
    </div>
  );
}

export function CustomNumberInput(props: {
  value: string;
  onChange(value: string): void;
  locale: Locale;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  variant?: 'default' | 'panel';
  fullWidth?: boolean;
  showSpinButtons?: boolean;
  align?: 'center' | 'left' | 'right';
  inputWidth?: number | string;
  ariaLabel?: string;
  disabled?: boolean;
  id?: string;
}): React.JSX.Element {
  const autoId = useId();
  const inputId = props.id ?? autoId;
  const stepAmount = props.step ?? 1;
  const minV = props.min;
  const maxV = props.max;
  const variant = props.variant ?? 'default';
  const align = props.align ?? 'center';
  const fullWidth = props.fullWidth ?? false;
  const showSpin = props.showSpinButtons ?? false;

  const numericValue = ((): number => {
    if (props.value.trim() === '') {
      return Number.NaN;
    }
    const n = Number(props.value);
    return Number.isFinite(n) ? n : Number.NaN;
  })();

  const hasMin = minV !== undefined;
  const hasMax = maxV !== undefined;

  const isStepDownDisabled =
    props.disabled === true
    || (hasMin && !Number.isNaN(numericValue) && numericValue <= minV);

  const isStepUpDisabled =
    props.disabled === true
    || (hasMax && !Number.isNaN(numericValue) && numericValue >= maxV);

  const resolvedWidth =
    props.inputWidth === undefined || props.inputWidth === ''
      ? undefined
      : typeof props.inputWidth === 'number'
        ? `${String(props.inputWidth)}px`
        : props.inputWidth;

  function applyStep(sign: 1 | -1): void {
    let current = numericValue;
    if (!Number.isFinite(current)) {
      current = minV !== undefined ? minV : stepAmount;
    }
    let next = current + sign * stepAmount;
    if (hasMin) {
      next = Math.max(minV, next);
    }
    if (hasMax) {
      next = Math.min(maxV, next);
    }
    props.onChange(String(next));
  }

  function clampAndCommit(raw: string): void {
    const trimmed = raw.trim();
    if (trimmed === '') {
      props.onChange('');
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
      props.onChange('');
      return;
    }
    let next = n;
    if (hasMin) {
      next = Math.max(minV, next);
    }
    if (hasMax) {
      next = Math.min(maxV, next);
    }
    props.onChange(String(next));
  }

  return (
    <div
      className={[
        'custom-number-input',
        `custom-number-input--${variant}`,
        fullWidth ? 'custom-number-input--full-width' : ''
      ].filter(Boolean).join(' ')}
    >
      {props.label === undefined || props.label === '' ? null : (
        <label className="custom-number-input-label" htmlFor={inputId}>
          {props.label}
        </label>
      )}
      <div className={`custom-number-input-wrap${fullWidth ? ' custom-number-input-wrap--full-width' : ''}`}>
        <input
          aria-label={props.ariaLabel}
          className={[
            'custom-number-input-field',
            `custom-number-input-field--${variant}`,
            `custom-number-input-field--align-${align}`,
            showSpin ? 'custom-number-input-field--with-spin' : '',
            fullWidth ? 'custom-number-input-field--full-width' : ''
          ].filter(Boolean).join(' ')}
          disabled={props.disabled}
          id={inputId}
          inputMode="decimal"
          max={maxV}
          min={minV}
          step={stepAmount}
          type="number"
          value={props.value}
          style={resolvedWidth === undefined ? undefined : { width: resolvedWidth }}
          onBlur={() => {
            clampAndCommit(props.value);
          }}
          onChange={(event) => {
            props.onChange(event.currentTarget.value);
          }}
        />
        {showSpin ? (
          <NumberSpinButtons
            isStepDownDisabled={isStepDownDisabled}
            isStepUpDisabled={isStepUpDisabled}
            locale={props.locale}
            onStepDown={() => {
              applyStep(-1);
            }}
            onStepUp={() => {
              applyStep(1);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
