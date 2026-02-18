/**
 * BottomSheet - Slide-up action sheet with drag handle.
 *
 * Spec (page 13):
 * - Position: absolute bottom 0 within phone frame
 * - Background: #16161A
 * - Top border radius: 18px
 * - Top border: 1px solid rgba(255,255,255,0.08)
 * - Z-index: 400
 * - Enter: translateY(100%) → 0, 280ms cubic-bezier(0.32,0.72,0,1)
 * - Exit: translateY(100%), 220ms same easing
 * - Drag handle: 32x4px, radius 2px, rgba(255,255,255,0.15), centered, 10px padding top
 * - Sheet title: DM Serif Display 13px, #F0ECE4, -0.01em, padding 4px 18px 10px
 * - Title border-bottom: 1px solid rgba(255,255,255,0.05)
 * - Dismiss: tap scrim, swipe down, or cancel button
 */

import { type ReactNode, type CSSProperties, useCallback, useRef } from 'react';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import { Scrim } from './Scrim';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

const SWIPE_THRESHOLD = 80;

const sheetEasing: [number, number, number, number] = [0.32, 0.72, 0, 1];

const sheetStyle: CSSProperties = {
  position: 'fixed',
  bottom: 0,
  left: 0,
  right: 0,
  background: 'var(--color-sheet-bg)',
  borderTopLeftRadius: 'var(--sheet-radius-top)',
  borderTopRightRadius: 'var(--sheet-radius-top)',
  borderTop: '1px solid var(--color-border-sheet)',
  zIndex: 'var(--z-sheet)' as unknown as number,
  maxHeight: '85vh',
  overflowY: 'auto',
  touchAction: 'none',
};

const handleStyle: CSSProperties = {
  width: 'var(--sheet-handle-width)',
  height: 'var(--sheet-handle-height)',
  borderRadius: '2px',
  background: 'var(--sheet-handle-color)',
  margin: '10px auto 0',
};

const titleStyle: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: '13px',
  fontWeight: 400,
  letterSpacing: '-0.01em',
  color: 'var(--color-text-primary)',
  padding: '4px 18px 10px',
  borderBottom: '1px solid var(--color-divider)',
};

export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);

  const handleDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      if (info.offset.y > SWIPE_THRESHOLD) {
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
            ref={sheetRef}
            style={sheetStyle}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{
              type: 'tween',
              duration: 0.28,
              ease: sheetEasing,
            }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0.3}
            onDragEnd={handleDragEnd}
            data-testid="bottom-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={title || 'Action sheet'}
          >
            {/* Drag handle */}
            <div style={handleStyle} data-testid="sheet-handle" />

            {/* Title */}
            {title && <div style={titleStyle}>{title}</div>}

            {/* Content */}
            <div style={{ padding: '8px 8px 16px' }}>{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
