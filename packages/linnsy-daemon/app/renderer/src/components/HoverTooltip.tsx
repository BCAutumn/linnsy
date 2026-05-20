import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type HoverTooltipPlacement = 'top' | 'bottom';

interface HoverTooltipProps {
  text: string;
  /** 默认在触发器下方弹出；行内图标按钮主要用这个方向。 */
  placement?: HoverTooltipPlacement;
  /** 触发器与浮层间距，默认 8px。 */
  offset?: number;
  /** 不渲染时透传 children，方便调用方按需关闭 tooltip。 */
  disabled?: boolean;
  children: React.ReactNode;
}

/**
 * Hover/Focus 触发的轻量提示气泡。
 *
 * 使用 fixed + portal，避免被列表行、弹窗或滚动容器的 overflow 裁掉。
 */
export function HoverTooltip(props: HoverTooltipProps): React.JSX.Element {
  const placement = props.placement ?? 'bottom';
  const offset = props.offset ?? 8;
  const disabled = props.disabled ?? false;

  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const updatePosition = useCallback((): void => {
    const triggerEl = triggerRef.current;
    const tooltipEl = tooltipRef.current;
    if (triggerEl === null || tooltipEl === null) {
      return;
    }
    const triggerRect = triggerEl.getBoundingClientRect();
    const tooltipRect = tooltipEl.getBoundingClientRect();

    const viewportPadding = 8;
    const centerLeft = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
    const maxLeft = window.innerWidth - tooltipRect.width - viewportPadding;
    const clampedLeft = Math.min(Math.max(centerLeft, viewportPadding), Math.max(viewportPadding, maxLeft));

    if (placement === 'top') {
      setPosition({
        top: triggerRect.top - tooltipRect.height - offset,
        left: clampedLeft
      });
      return;
    }
    setPosition({
      top: triggerRect.bottom + offset,
      left: clampedLeft
    });
  }, [offset, placement]);

  useEffect(() => {
    if (!visible) {
      return undefined;
    }
    // 等 tooltip 节点挂到 DOM 后再测量，避免第一次 hover 位置偏移。
    const raf = window.requestAnimationFrame(() => {
      updatePosition();
    });
    function handleViewport(): void {
      updatePosition();
    }
    window.addEventListener('resize', handleViewport);
    window.addEventListener('scroll', handleViewport, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', handleViewport);
      window.removeEventListener('scroll', handleViewport, true);
    };
  }, [visible, updatePosition]);

  if (disabled || props.text.length === 0) {
    return <>{props.children}</>;
  }

  const showTooltip = (): void => {
    setVisible(true);
  };
  const hideTooltip = (): void => {
    setVisible(false);
  };

  return (
    <>
      <span
        ref={triggerRef}
        className="hover-tooltip-trigger"
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
      >
        {props.children}
      </span>
      {visible
        ? createPortal(
            <div
              ref={tooltipRef}
              className={`hover-tooltip hover-tooltip--${placement}`}
              role="tooltip"
              style={{ top: `${String(position.top)}px`, left: `${String(position.left)}px` }}
            >
              {props.text}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
