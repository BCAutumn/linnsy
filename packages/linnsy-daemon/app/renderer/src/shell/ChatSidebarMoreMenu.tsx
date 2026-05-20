import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { FluentIcon, type FluentIconName } from '../components/FluentIcon.js';
import { getLinnsyPortalRoot } from '../lib/linnsy-portal-host.js';
import { deriveSidebarMoreMenuLayout, type SidebarMoreMenuLayout } from './chat-sidebar-menu-layout.js';

export interface ChatSidebarMenuItem {
  id: string;
  label: string;
  icon: FluentIconName;
  danger?: boolean;
  onSelect: () => void;
}

export function ChatSidebarMoreMenu(props: {
  anchorRef: React.RefObject<HTMLElement>;
  ariaLabel: string;
  items: readonly ChatSidebarMenuItem[];
  onClose: () => void;
}): React.JSX.Element | null {
  const { anchorRef, ariaLabel, items, onClose } = props;
  const menuRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<SidebarMoreMenuLayout | null>(null);

  useLayoutEffect(() => {
    function sync(): void {
      const anchor = anchorRef.current;
      if (anchor === null) {
        return;
      }
      const rect = anchor.getBoundingClientRect();
      setLayout(deriveSidebarMoreMenuLayout({
        anchorRect: rect,
        viewportWidth: window.innerWidth
      }));
    }
    sync();
    window.addEventListener('scroll', sync, true);
    window.addEventListener('resize', sync);
    return () => {
      window.removeEventListener('scroll', sync, true);
      window.removeEventListener('resize', sync);
    };
  }, [anchorRef]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (anchorRef.current?.contains(target) ?? false) {
        return;
      }
      if (menuRef.current?.contains(target) ?? false) {
        return;
      }
      onClose();
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [anchorRef, onClose]);

  const target = getLinnsyPortalRoot(anchorRef.current);
  const menu = (
    <div
      aria-label={ariaLabel}
      className="conv-more-menu custom-select-options custom-select-options--portal is-opening"
      ref={menuRef}
      role="menu"
      style={layout === null
        ? { left: 0, position: 'fixed', top: 0, visibility: 'hidden', width: 0, zIndex: 70 }
        : { left: layout.left, position: 'fixed', top: layout.top, width: layout.width, zIndex: 70 }}
    >
      {items.map((item) => (
        <button
          className={`custom-select-option conv-more-menu-item${item.danger === true ? ' is-danger' : ''}`}
          key={item.id}
          onClick={() => {
            item.onSelect();
            onClose();
          }}
          role="menuitem"
          type="button"
        >
          <span className="custom-select-option-icon">
            <FluentIcon aria-hidden="true" name={item.icon} size={16} />
          </span>
          <span className="custom-select-option-label">{item.label}</span>
        </button>
      ))}
    </div>
  );

  return createPortal(menu, target);
}
