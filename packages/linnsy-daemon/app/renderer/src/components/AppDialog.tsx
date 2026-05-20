import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { FluentIcon } from './FluentIcon.js';

const APP_DIALOG_TRANSITION_MS = 160;

export interface AppDialogControls {
  requestClose: () => void;
}

export function AppDialog(props: {
  ariaLabel: string;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode | ((controls: AppDialogControls) => React.ReactNode);
  headerEnd?: React.ReactNode;
  onClose: () => void;
  bodyClassName?: string;
  backdropClassName?: string;
  className?: string;
  closeLabel?: string;
  closeOnBackdrop?: boolean;
  footerClassName?: string;
  headerClassName?: string;
  showCloseButton?: boolean;
  size?: 'md' | 'lg';
}): React.JSX.Element {
  const {
    ariaLabel,
    backdropClassName: customBackdropClassName,
    bodyClassName,
    children,
    className: customDialogClassName,
    closeOnBackdrop = true,
    footer: footerProp,
    footerClassName,
    headerClassName,
    headerEnd,
    onClose,
    showCloseButton,
    title
  } = props;
  const size = props.size ?? 'md';
  const closeLabel = props.closeLabel ?? 'Close';
  const closeTimerRef = useRef<number | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  const clearCloseTimer = useCallback((): void => {
    if (closeTimerRef.current === null) {
      return;
    }
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const requestClose = useCallback((): void => {
    if (isClosing) {
      return;
    }
    setIsClosing(true);
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
    }, APP_DIALOG_TRANSITION_MS);
  }, [clearCloseTimer, isClosing, onClose]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        requestClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [requestClose]);

  useEffect(() => () => {
    clearCloseTimer();
  }, [clearCloseTimer]);

  function handleBackdropClick(event: React.MouseEvent<HTMLDivElement>): void {
    if (!closeOnBackdrop || event.target !== event.currentTarget) {
      return;
    }
    requestClose();
  }

  const headerActions = headerEnd !== undefined || showCloseButton === true;
  const footer = useMemo((): React.ReactNode => {
    if (typeof footerProp === 'function') {
      return footerProp({ requestClose });
    }
    return footerProp;
  }, [footerProp, requestClose]);
  const backdropClassName = [
    'app-dialog-backdrop',
    isClosing ? 'app-dialog-backdrop--closing' : '',
    customBackdropClassName ?? ''
  ].filter((part) => part.length > 0).join(' ');
  const dialogClassName = [
    'app-dialog',
    `app-dialog--${size}`,
    isClosing ? 'app-dialog--closing' : '',
    customDialogClassName ?? ''
  ].filter((part) => part.length > 0).join(' ');

  return (
    <div
      className={backdropClassName}
      onClick={handleBackdropClick}
      role="presentation"
    >
      <section
        aria-label={ariaLabel}
        aria-modal="true"
        className={dialogClassName}
        role="dialog"
      >
        <header className={`app-dialog-header${headerClassName === undefined ? '' : ` ${headerClassName}`}`}>
          <strong>{title}</strong>
          {headerActions ? (
            <div className="app-dialog-header-actions">
              {headerEnd}
              {showCloseButton === true ? (
                <button
                  aria-label={closeLabel}
                  className="app-dialog-close"
                  onClick={requestClose}
                  title={closeLabel}
                  type="button"
                >
                  <FluentIcon aria-hidden="true" name="dismiss" size={15} />
                </button>
              ) : null}
            </div>
          ) : null}
        </header>
        <div className={`app-dialog-body${bodyClassName === undefined ? '' : ` ${bodyClassName}`}`}>
          {children}
        </div>
        {footer === undefined ? null : (
          <footer className={`app-dialog-footer${footerClassName === undefined ? '' : ` ${footerClassName}`}`}>
            {footer}
          </footer>
        )}
      </section>
    </div>
  );
}
