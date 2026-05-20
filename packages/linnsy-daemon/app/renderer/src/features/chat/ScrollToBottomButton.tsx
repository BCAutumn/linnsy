import React from 'react';

import { FluentIcon } from '../../components/FluentIcon.js';

export function ScrollToBottomButton(props: {
  ariaLabel: string;
  onClick: () => void;
  pendingItemCount: number;
  title: string;
  visible: boolean;
}): React.JSX.Element {
  const className = `jump-to-bottom-btn${props.visible ? ' is-visible' : ' is-hidden'}`;

  return (
    <button
      type="button"
      className={className}
      aria-label={props.ariaLabel}
      aria-hidden={props.visible ? undefined : true}
      onClick={() => {
        if (!props.visible) return;
        props.onClick();
      }}
      tabIndex={props.visible ? undefined : -1}
      title={props.title}
    >
      <FluentIcon aria-hidden="true" className="jump-to-bottom-btn__icon" name="arrowUp" size={18} />
      {props.pendingItemCount > 0 ? (
        <span aria-hidden="true" className="jump-to-bottom-btn__count">
          {props.pendingItemCount}
        </span>
      ) : null}
    </button>
  );
}
