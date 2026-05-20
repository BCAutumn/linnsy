import React from 'react';

export type FluentIconName =
  | 'add'
  | 'alert'
  | 'apps'
  | 'archive'
  | 'arrowUp'
  | 'bot'
  | 'brainCircuit'
  | 'checkmark'
  | 'chevronLeft'
  | 'chevronRight'
  | 'clock'
  | 'code'
  | 'color'
  | 'copy'
  | 'delete'
  | 'document'
  | 'dismiss'
  | 'eye'
  | 'eyeOff'
  | 'globe'
  | 'edit'
  | 'moreHorizontal'
  | 'pause'
  | 'pin'
  | 'play'
  | 'phone'
  | 'search'
  | 'settings'
  | 'shield'
  | 'taskListLtr'
  | 'textBold'
  | 'textBulletList'
  | 'textHeader2'
  | 'textItalic'
  | 'textNumberList'
  | 'textQuote'
  | 'wrench';

export function FluentIcon(props: {
  name: FluentIconName;
  size?: number;
  className?: string;
  'aria-hidden'?: boolean | 'true';
}): React.JSX.Element {
  const size = props.size ?? 20;
  return (
    <span
      aria-hidden={props['aria-hidden'] ?? true}
      className={`fluent-icon fluent-icon--${props.name}${props.className === undefined ? '' : ` ${props.className}`}`}
      style={{ '--icon-size': `${String(size)}px` } as React.CSSProperties}
    />
  );
}
