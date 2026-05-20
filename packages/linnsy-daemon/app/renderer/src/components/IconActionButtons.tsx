import React from 'react';

import { FluentIcon, type FluentIconName } from './FluentIcon.js';
import { HoverTooltip, type HoverTooltipPlacement } from './HoverTooltip.js';

export interface IconActionButtonItem<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  icon: FluentIconName;
  /** 不传或与 label 相同时直接复用 label；不需要 tooltip 时显式传空字符串。 */
  tooltip?: string;
}

export function IconActionButtons<T extends string>(props: {
  ariaLabel?: string;
  items: ReadonlyArray<IconActionButtonItem<T>>;
  onAction: (value: T) => void;
  size?: 'sm' | 'md';
  /** 全组按钮的 tooltip 弹出方向；默认 bottom，符合定时安排行内按钮的下方提示。 */
  tooltipPlacement?: HoverTooltipPlacement;
}): React.JSX.Element {
  const size = props.size ?? 'md';
  const iconSize = size === 'sm' ? 15 : 17;
  const tooltipPlacement = props.tooltipPlacement ?? 'bottom';

  return (
    <div
      aria-label={props.ariaLabel}
      className={`icon-action-buttons icon-action-buttons--${size}`}
      role="toolbar"
    >
      {props.items.map((item) => {
        const tooltipText = item.tooltip ?? item.label;
        const button = (
          <button
            aria-label={item.label}
            className="icon-action-button"
            disabled={item.disabled}
            onClick={() => {
              props.onAction(item.value);
            }}
            type="button"
          >
            <FluentIcon aria-hidden="true" name={item.icon} size={iconSize} />
          </button>
        );
        return (
          <HoverTooltip
            key={item.value}
            placement={tooltipPlacement}
            text={tooltipText}
          >
            {button}
          </HoverTooltip>
        );
      })}
    </div>
  );
}
