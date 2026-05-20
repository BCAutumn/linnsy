import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_TRANSITION_MS = 150;

// 弹层关闭时保留一小段卸载延迟，让 CSS 的离场动画能完整播完。
export function useDisclosureTransition(durationMs = DEFAULT_TRANSITION_MS): {
  close: () => void;
  isClosing: boolean;
  isOpen: boolean;
  isVisible: boolean;
  open: () => void;
  toggle: () => void;
} {
  const closeTimerRef = useRef<number | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const clearCloseTimer = useCallback((): void => {
    if (closeTimerRef.current === null) {
      return;
    }
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const open = useCallback((): void => {
    clearCloseTimer();
    setIsClosing(false);
    setIsOpen(true);
  }, [clearCloseTimer]);

  const close = useCallback((): void => {
    if (!isOpen) {
      return;
    }
    clearCloseTimer();
    setIsOpen(false);
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      setIsClosing(false);
      closeTimerRef.current = null;
    }, durationMs);
  }, [clearCloseTimer, durationMs, isOpen]);

  const toggle = useCallback((): void => {
    if (isOpen) {
      close();
      return;
    }
    open();
  }, [close, isOpen, open]);

  useEffect(() => () => {
    clearCloseTimer();
  }, [clearCloseTimer]);

  return {
    close,
    isClosing,
    isOpen,
    isVisible: isOpen || isClosing,
    open,
    toggle
  };
}
