import React from 'react';

import { FluentIcon, type FluentIconName } from './FluentIcon.js';

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
  icon?: FluentIconName;
}

export function SegmentedControl<T extends string>(props: {
  ariaLabel?: string;
  onChange: (value: T) => void;
  options: ReadonlyArray<SegmentedControlOption<T>>;
  size?: 'sm' | 'md';
  value: T;
}): React.JSX.Element {
  const size = props.size ?? 'md';
  return (
    <div aria-label={props.ariaLabel} className={`seg-control seg-control--${size}`} role="tablist">
      {props.options.map((option) => (
        <button
          aria-selected={option.value === props.value}
          className={option.value === props.value ? 'active' : ''}
          key={option.value}
          onClick={() => {
            props.onChange(option.value);
          }}
          role="tab"
          type="button"
        >
          {option.icon === undefined ? null : <FluentIcon aria-hidden="true" name={option.icon} size={size === 'sm' ? 13 : 15} />}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}
