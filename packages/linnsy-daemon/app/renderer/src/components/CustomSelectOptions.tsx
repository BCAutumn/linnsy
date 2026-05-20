import React from 'react';

import type { CustomSelectOption, SelectItem } from './custom-select-types.js';

export function renderOption<T extends string>(params: {
  option: CustomSelectOption<T>;
  index: number;
  isSelected: boolean;
  isKeyboardSelected: boolean;
  onChoose(option: CustomSelectOption<T>): void;
  onHover(index: number): void;
}): React.JSX.Element {
  const { option } = params;
  if ('isGroup' in option) {
    return <div className="custom-select-group" key={`group-${option.label}`}>{option.label}</div>;
  }
  if ('isSeparator' in option) {
    return <div aria-hidden="true" className="custom-select-separator" key={`separator-${String(params.index)}`} />;
  }
  const classNames = [
    'custom-select-option',
    params.isSelected ? 'is-selected' : '',
    params.isKeyboardSelected ? 'is-keyboard-selected' : '',
    option.disabled ? 'is-disabled' : '',
    option.variant === 'danger' ? 'is-danger' : ''
  ].filter(Boolean).join(' ');

  return (
    <button
      aria-selected={params.isSelected}
      className={classNames}
      data-option-index={params.index}
      disabled={option.disabled}
      key={option.value}
      onClick={() => {
        params.onChoose(option);
      }}
      onMouseEnter={() => {
        if (!option.disabled) {
          params.onHover(params.index);
        }
      }}
      role="option"
      type="button"
    >
      {option.icon === undefined ? null : <span className="custom-select-option-icon">{option.icon}</span>}
      <span className="custom-select-option-label">{option.text}</span>
      {option.shortcut === undefined ? null : <span className="custom-select-shortcut">{option.shortcut}</span>}
    </button>
  );
}

export function findOptionByValue<T extends string>(
  options: ReadonlyArray<CustomSelectOption<T>>,
  value: T
): SelectItem<T> | undefined {
  return options.find((option): option is SelectItem<T> => isSelectableOption(option) && option.value === value);
}

export function findSelectedIndex<T extends string>(
  options: ReadonlyArray<CustomSelectOption<T>>,
  value: T
): number {
  return options.findIndex((option) => isSelectableOption(option) && option.value === value);
}

export function findFirstSelectableIndex<T extends string>(options: ReadonlyArray<CustomSelectOption<T>>): number {
  return options.findIndex(isSelectableOption);
}

export function findNextSelectableIndex<T extends string>(
  options: ReadonlyArray<CustomSelectOption<T>>,
  currentIndex: number,
  direction: 1 | -1
): number {
  if (options.length === 0) {
    return -1;
  }
  let nextIndex = currentIndex === -1 && direction === -1 ? 0 : currentIndex;
  for (let attempts = 0; attempts < options.length; attempts += 1) {
    nextIndex = (nextIndex + direction + options.length) % options.length;
    const option = options[nextIndex];
    if (option !== undefined && isSelectableOption(option)) {
      return nextIndex;
    }
  }
  return -1;
}

export function isSelectableOption<T extends string>(option: CustomSelectOption<T>): option is SelectItem<T> {
  return !('isGroup' in option) && !('isSeparator' in option) && option.disabled !== true;
}

export function resolveCssPx(value: number | string, fallback: number): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  const trimmed = value.trim();
  const n = Number.parseFloat(trimmed);
  return Number.isFinite(n) ? n : fallback;
}
