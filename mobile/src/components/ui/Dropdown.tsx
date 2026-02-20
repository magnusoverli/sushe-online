/**
 * Dropdown / Sort Selector - Floating menu anchored below a trigger.
 *
 * Spec (page 11):
 * - Position: absolute, anchored top-right below trigger, 6px gap
 * - Width: 160px fixed
 * - Background: #16161A
 * - Border: 1px solid rgba(255,255,255,0.10), radius 12px
 * - Shadow: 0 16px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)
 * - Enter: scale(0.95) opacity 0 → scale(1) opacity 1, 180ms ease-out, origin top right
 * - Section label: DM Mono 6.5px CAPS +0.15em, rgba(255,255,255,0.20), padding 8px 12px 5px
 * - Item: DM Mono 8.5px, rgba(255,255,255,0.55), padding 8px 12px
 * - Item divider: 1px rgba(255,255,255,0.04) inset 12px
 * - Selected: bg rgba(232,200,122,0.08) + left border 2px #E8C87A, text #E8C87A + checkmark
 * - Dismiss: tap outside or select item
 */

import { type CSSProperties, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Check } from 'lucide-react';

export interface DropdownItem {
  id: string;
  label: string;
}

interface DropdownProps {
  open: boolean;
  onClose: () => void;
  items: DropdownItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  sectionLabel?: string;
  /** Anchor position (top-right of trigger) */
  anchorRef?: React.RefObject<HTMLElement | null>;
}

const menuStyle: CSSProperties = {
  position: 'absolute',
  width: 'var(--dropdown-width)',
  background: 'var(--color-sheet-bg)',
  border: '1px solid var(--color-border-menu)',
  borderRadius: 'var(--dropdown-radius)',
  boxShadow: '0 16px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)',
  zIndex: 'var(--z-sheet)' as unknown as number,
  overflow: 'hidden',
  transformOrigin: 'top right',
};

const sectionLabelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '10px',
  fontWeight: 400,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)',
  padding: '8px 12px 5px',
};

export function Dropdown({
  open,
  onClose,
  items,
  selectedId,
  onSelect,
  sectionLabel,
  anchorRef,
}: DropdownProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Click outside to close
  const handleClickOutside = useCallback(
    (e: MouseEvent | TouchEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        anchorRef?.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    },
    [onClose, anchorRef]
  );

  useEffect(() => {
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('touchstart', handleClickOutside);
      };
    }
  }, [open, handleClickOutside]);

  // Compute position relative to anchor
  const getPosition = (): CSSProperties => {
    if (!anchorRef?.current) {
      return { top: '6px', right: '0' };
    }
    const rect = anchorRef.current.getBoundingClientRect();
    return {
      position: 'fixed',
      top: `${rect.bottom + 6}px`,
      right: `${window.innerWidth - rect.right}px`,
    };
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={menuRef}
          style={{ ...menuStyle, ...getPosition() }}
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          role="listbox"
          data-testid="dropdown"
        >
          {sectionLabel && <div style={sectionLabelStyle}>{sectionLabel}</div>}
          {items.map((item, index) => {
            const isSelected = item.id === selectedId;
            return (
              <div key={item.id}>
                {index > 0 && (
                  <div
                    style={{
                      height: '1px',
                      background: 'var(--color-divider-menu)',
                      margin: '0 12px',
                    }}
                  />
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    width: '100%',
                    padding: '8px 12px',
                    background: isSelected
                      ? 'rgba(232,200,122,0.08)'
                      : 'transparent',
                    borderLeft: isSelected
                      ? '2px solid var(--color-gold)'
                      : '2px solid transparent',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'background 150ms ease',
                    gap: '8px',
                  }}
                  onClick={() => {
                    onSelect(item.id);
                    onClose();
                  }}
                  data-testid={`dropdown-item-${item.id}`}
                >
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '10px',
                      fontWeight: 400,
                      color: isSelected
                        ? 'var(--color-gold)'
                        : 'rgba(255,255,255,0.55)',
                      flex: 1,
                      textAlign: 'left',
                    }}
                  >
                    {item.label}
                  </span>
                  {isSelected && (
                    <Check
                      size={11}
                      style={{
                        color: 'var(--color-gold)',
                        flexShrink: 0,
                      }}
                    />
                  )}
                </button>
              </div>
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
