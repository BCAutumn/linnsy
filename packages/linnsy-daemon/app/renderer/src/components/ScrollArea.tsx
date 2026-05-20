import React from 'react';

type ScrollAreaTag = 'article' | 'div' | 'nav' | 'section';
export type ScrollAreaScrollbarVisibility = 'hover' | 'persistent';

export const ScrollArea = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement> & {
  as?: ScrollAreaTag;
  scrollbarVisibility?: ScrollAreaScrollbarVisibility;
}>(function ScrollArea(props, ref): React.JSX.Element {
  const { as: Tag = 'div', className, scrollbarVisibility = 'hover', ...rest } = props;
  const visibilityClass = scrollbarVisibility === 'persistent' ? ' scroll-area--persistent' : '';
  return React.createElement(Tag, {
    ...rest,
    ref,
    className: `scroll-area${visibilityClass}${className === undefined ? '' : ` ${className}`}`
  });
});
