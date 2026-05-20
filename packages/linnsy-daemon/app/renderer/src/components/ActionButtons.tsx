import React from 'react';

export function ActionButtons(props: {
  canPrimaryAction?: boolean;
  isPrimaryActionDisabled?: boolean;
  isSecondaryActionDisabled?: boolean;
  onPrimaryAction: () => void;
  onSecondaryAction?: () => void;
  primaryVariant?: 'default' | 'danger' | 'neutral';
  primaryActionText: string;
  secondaryActionText?: string;
  secondaryVariant?: 'filled' | 'ghost' | 'plain' | 'danger';
  showPrimaryAction?: boolean;
  showSecondaryAction?: boolean;
  size?: 'compact' | 'sm' | 'md';
}): React.JSX.Element {
  const size = props.size ?? 'md';
  const showPrimaryAction = props.showPrimaryAction ?? true;
  const showSecondaryAction = props.showSecondaryAction ?? true;
  const canPrimaryAction = props.canPrimaryAction ?? true;
  const isPrimaryDisabled = props.isPrimaryActionDisabled === true || !canPrimaryAction;
  const isSecondaryDisabled = props.isSecondaryActionDisabled === true;
  const primaryVariant = props.primaryVariant ?? 'default';
  const secondaryVariant = props.secondaryVariant ?? 'filled';

  return (
    <div className={`action-buttons-container action-buttons-container--${size}`}>
      {showSecondaryAction ? (
        <button
          className={`action-btn secondary secondary-${secondaryVariant}`}
          disabled={isSecondaryDisabled}
          onClick={props.onSecondaryAction}
          type="button"
        >
          {props.secondaryActionText ?? ''}
        </button>
      ) : null}
      {showPrimaryAction ? (
        <button
          className={`action-btn primary${readPrimaryVariantClassName(primaryVariant)}`}
          disabled={isPrimaryDisabled}
          onClick={props.onPrimaryAction}
          type="button"
        >
          {props.primaryActionText}
        </button>
      ) : null}
    </div>
  );
}

function readPrimaryVariantClassName(variant: 'default' | 'danger' | 'neutral'): string {
  if (variant === 'danger') {
    return ' primary-danger';
  }
  if (variant === 'neutral') {
    return ' primary-neutral';
  }
  return '';
}
