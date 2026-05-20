import React from 'react';

import { calculateSettingsRangeProgress } from '../lib/settings-range.js';

type SettingsRangeSliderStyle = React.CSSProperties & {
  '--settings-range-progress': string;
};

export interface SettingsRangeSliderProps {
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  valueLabel?: string;
  minLabel: string;
  maxLabel: string;
  disabled?: boolean;
  onChange(value: number): void;
}

export function SettingsRangeSlider(props: SettingsRangeSliderProps): React.JSX.Element {
  const progress = calculateSettingsRangeProgress({
    min: props.min,
    max: props.max,
    value: props.value
  });
  const valueLabel = props.valueLabel ?? String(props.value);
  const style: SettingsRangeSliderStyle = {
    '--settings-range-progress': `${String(progress)}%`
  };

  return (
    <div className="settings-range-control">
      <span className="settings-range-value">{valueLabel}</span>
      <div className="settings-range-wrapper">
        <input
          aria-label={props.ariaLabel}
          aria-valuetext={valueLabel}
          className="settings-range-input"
          disabled={props.disabled}
          max={props.max}
          min={props.min}
          onChange={(event) => {
            props.onChange(event.currentTarget.valueAsNumber);
          }}
          step={props.step}
          style={style}
          type="range"
          value={props.value}
        />
        <div className="settings-range-labels" aria-hidden="true">
          <span>{props.minLabel}</span>
          <span>{props.maxLabel}</span>
        </div>
      </div>
    </div>
  );
}
