/**
 * ContextMenu - Floating per-album action menu.
 *
 * Spec (page 14):
 * - Position: absolute, near three-dot button, avoids screen edges
 * - Width: 170px fixed
 * - Background: #16161A
 * - Border: 1px solid rgba(255,255,255,0.10), radius 12px
 * - Shadow: 0 16px 40px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.04)
 * - Z-index: 500
 * - Enter: scale(0.90) opacity 0 → scale(1) opacity 1, 160ms ease-out, origin top right
 * - Context header: mini cover 24x24 radius 4px + title DM Serif 8px + artist DM Mono 6px
 * - Item: 7px padding, radius 7px, icon 13x13px, label DM Mono 8px, gap 9px
 * - Destructive: icon + label #E05C5C
 * - Pre-destructive divider: 1px rgba(255,255,255,0.07), margin 2px 4px
 * - Dismiss: tap outside, tap item, Escape
 */

import {
  type ReactNode,
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

interface ContextMenuHeader {
  title: string;
  artist: string;
  coverElement?: ReactNode;
}

export interface ContextMenuItem {
  id: string;
  icon: ReactNode;
  label: string;
  destructive?: boolean;
  /** Insert a visible divider before this item */
  dividerBefore?: boolean;
  onClick?: () => void;
}

interface ContextMenuProps {
  open: boolean;
  onClose: () => void;
  header?: ContextMenuHeader;
  items: ContextMenuItem[];
  /** Anchor position (the three-dot button) */
  anchorRef?: React.RefObject<HTMLElement | null>;
}

const menuStyle: CSSProperties = {
  position: 'fixed',
  width: 'var(--context-menu-width)',
  background: 'var(--color-sheet-bg)',
  border: '1px solid var(--color-border-menu)',
  borderRadius: 'var(--context-menu-radius)',
  boxShadow: '0 16px 40px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.04)',
  zIndex: 'var(--z-context-menu)' as unknown as number,
  overflow: 'hidden',
  transformOrigin: 'top right',
  padding: '4px',
};

export function ContextMenu({
  open,
  onClose,
  header,
  items,
  anchorRef,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Click outside to close
  const handleClickOutside = useCallback(
    (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose]
  );

  // Escape to close
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('touchstart', handleClickOutside);
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [open, handleClickOutside, handleKeyDown]);

  // Position near anchor with edge avoidance
  const getPosition = (): CSSProperties => {
    if (!anchorRef?.current) {
      return { top: '0', right: '0' };
    }
    const rect = anchorRef.current.getBoundingClientRect();
    const menuWidth = 170;

    let top = rect.bottom + 4;
    let right = window.innerWidth - rect.right;

    // Bottom edge avoidance
    if (top + 200 > window.innerHeight) {
      top = rect.top - 200;
    }

    // Right edge avoidance
    if (right + menuWidth > window.innerWidth) {
      right = 8;
    }

    // Left edge avoidance
    if (window.innerWidth - right - menuWidth < 8) {
      right = window.innerWidth - menuWidth - 8;
    }

    return { top: `${top}px`, right: `${right}px` };
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={menuRef}
          style={{ ...menuStyle, ...getPosition() }}
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          role="menu"
          data-testid="context-menu"
        >
          {/* Context header */}
          {header && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 8px 8px',
                borderBottom: '1px solid var(--color-divider)',
                marginBottom: '2px',
              }}
            >
              {header.coverElement && (
                <div
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    flexShrink: 0,
                  }}
                >
                  {header.coverElement}
                </div>
              )}
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: '10px',
                    fontWeight: 400,
                    color: 'var(--color-text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {header.title}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '9px',
                    fontWeight: 400,
                    color: 'var(--color-text-secondary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {header.artist}
                </div>
              </div>
            </div>
          )}

          {/* Menu items */}
          {items.map((item) => (
            <div key={item.id}>
              {item.dividerBefore && (
                <div
                  style={{
                    height: '1px',
                    background: item.destructive
                      ? 'var(--color-divider-destructive)'
                      : 'rgba(255,255,255,0.07)',
                    margin: '2px 4px',
                  }}
                />
              )}
              <button
                type="button"
                role="menuitem"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '9px',
                  width: '100%',
                  padding: '7px 8px',
                  borderRadius: '7px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'background 150ms ease',
                  color: item.destructive
                    ? 'var(--color-destructive)'
                    : 'rgba(255,255,255,0.50)',
                }}
                onClick={() => {
                  item.onClick?.();
                  onClose();
                }}
                data-testid={`context-menu-item-${item.id}`}
              >
                <span
                  style={{
                    display: 'flex',
                    flexShrink: 0,
                    width: '13px',
                    height: '13px',
                  }}
                >
                  {item.icon}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '10px',
                    fontWeight: 400,
                    color: item.destructive
                      ? 'var(--color-destructive)'
                      : 'rgba(255,255,255,0.75)',
                    flex: 1,
                    textAlign: 'left',
                  }}
                >
                  {item.label}
                </span>
              </button>
            </div>
          ))}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
