import React from 'react';

export function ToggleSwitch(props: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange(checked: boolean): void;
}): React.JSX.Element {
  return (
    <button
      aria-checked={props.checked}
      aria-label={props.label}
      className="toggle-switch"
      disabled={props.disabled}
      onClick={() => {
        props.onChange(!props.checked);
      }}
      role="switch"
      type="button"
    >
      <span aria-hidden="true" />
    </button>
  );
}
