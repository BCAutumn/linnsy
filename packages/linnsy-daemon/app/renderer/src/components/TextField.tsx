import React, { useId } from 'react';

export function TextField(props: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  autoComplete?: string;
  className?: string;
  disabled?: boolean;
  inputMode?: React.InputHTMLAttributes<HTMLInputElement>['inputMode'];
  name?: string;
  placeholder?: string;
  trailingAction?: React.ReactNode;
  type?: React.HTMLInputTypeAttribute;
}): React.JSX.Element {
  const generatedId = useId();
  const inputType = props.type ?? 'text';

  return (
    <div className={`text-field${props.className === undefined ? '' : ` ${props.className}`}`}>
      <span className="text-field-label">{props.label}</span>
      <span className="text-field-control">
        <input
          aria-label={props.label}
          autoComplete={props.autoComplete}
          disabled={props.disabled}
          id={generatedId}
          inputMode={props.inputMode}
          name={props.name}
          onChange={(event) => {
            props.onValueChange(event.target.value);
          }}
          placeholder={props.placeholder}
          type={inputType}
          value={props.value}
        />
        {props.trailingAction === undefined ? null : (
          <span className="text-field-trailing">{props.trailingAction}</span>
        )}
      </span>
    </div>
  );
}
