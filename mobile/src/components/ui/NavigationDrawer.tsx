/**
 * NavigationDrawer - Slide-in panel from the left for list switching.
 *
 * Spec (page 12):
 * - Width: 80% of phone frame (max 312px)
 * - Height: full
 * - Background: #16161A
 * - Right border: 1px solid rgba(255,255,255,0.07)
 * - Z-index: 200
 * - Enter: translateX(-100%) → 0, 300ms cubic-bezier(0.32,0.72,0,1)
 * - Exit: translateX(-100%), 240ms same easing
 * - Dismiss: tap scrim, swipe left, or tap active item
 *
 * Drawer header:
 * - Eyebrow: DM Mono 7px CAPS +0.2em, rgba(255,255,255,0.25)
 * - Title: DM Serif Display 15px, #F0ECE4, -0.02em
 * - Bottom border: 1px solid rgba(255,255,255,0.05)
 * - Padding: 0 18px 14px
 *
 * Nav items:
 * - Default: transparent bg, 2px left border transparent
 * - Active: rgba(232,200,122,0.08) bg, 2px left border #E8C87A
 * - Label: DM Mono 8.5px
 * - Count badge: DM Mono 7px
 * - Item padding: 9px top/bottom, 10px left/right, radius 10px
 * - Item gap: 2px
 */

import { type ReactNode, type CSSProperties, useCallback, useRef } from 'react';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import { Scrim } from './Scrim';

interface NavigationDrawerProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  header?: ReactNode;
}

const SWIPE_CLOSE_THRESHOLD = -60;

const drawerEasing: [number, number, number, number] = [0.32, 0.72, 0, 1];

const drawerStyle: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  bottom: 0,
  width: '80%',
  maxWidth: '312px',
  background: 'var(--color-sheet-bg)',
  borderRight: '1px solid var(--drawer-border)',
  zIndex: 'var(--z-drawer)' as unknown as number,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
};

export function NavigationDrawer({
  open,
  onClose,
  children,
  header,
}: NavigationDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  const handleDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      if (info.offset.x < SWIPE_CLOSE_THRESHOLD) {
        onClose();
      }
    },
    [onClose]
  );

  return (
    <>
      <Scrim visible={open} onDismiss={onClose} />
      <AnimatePresence>
        {open && (
          <motion.div
            ref={drawerRef}
            style={drawerStyle}
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{
              type: 'tween',
              duration: 0.3,
              ease: drawerEasing,
            }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.15}
            onDragEnd={handleDragEnd}
            data-testid="navigation-drawer"
            role="navigation"
            aria-label="List navigation"
          >
            {/* Header */}
            {header && (
              <div
                style={{
                  padding: '0 18px 14px',
                  borderBottom: '1px solid var(--color-divider)',
                }}
              >
                {header}
              </div>
            )}

            {/* Content */}
            <div
              className="hide-scrollbar"
              style={{ flex: 1, overflowY: 'auto', padding: '8px 8px' }}
            >
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ── DrawerNavItem sub-component ──

export interface DrawerNavItemProps {
  label: string;
  count?: number;
  icon?: ReactNode;
  isActive?: boolean;
  onClick?: () => void;
}

export function DrawerNavItem({
  label,
  count,
  icon,
  isActive = false,
  onClick,
}: DrawerNavItemProps) {
  const color = isActive ? 'var(--color-gold)' : 'rgba(255,255,255,0.45)';
  const countColor = isActive
    ? 'rgba(232,200,122,0.50)'
    : 'rgba(255,255,255,0.20)';

  return (
    <button
      type="button"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        padding: '9px 10px',
        borderRadius: '10px',
        background: isActive ? 'rgba(232,200,122,0.08)' : 'transparent',
        borderLeft: isActive
          ? '2px solid var(--color-gold)'
          : '2px solid transparent',
        border: 'none',
        cursor: 'pointer',
        transition: 'background 150ms ease',
      }}
      onClick={onClick}
      data-testid="drawer-nav-item"
    >
      {icon && (
        <span style={{ color, display: 'flex', flexShrink: 0 }}>{icon}</span>
      )}
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '8.5px',
          fontWeight: 400,
          color,
          flex: 1,
          textAlign: 'left',
        }}
      >
        {label}
      </span>
      {count != null && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '7px',
            fontWeight: 400,
            color: countColor,
            flexShrink: 0,
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}
