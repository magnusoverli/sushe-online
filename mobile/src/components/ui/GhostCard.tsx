/**
 * GhostCard - Floating card during drag-and-drop reordering.
 *
 * Spec (page 8):
 * - Position: fixed, follows touch coordinates
 * - Background: #1E1E26
 * - Border: 1px solid rgba(255,255,255,0.18)
 * - Box shadow: 0 24px 64px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.06)
 * - Transform: scale(1.05) rotate(-1.5deg)
 * - Pointer events: none
 * - Z-index: 9999
 * - Touch offset: anchored to where finger first landed on card
 */

import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useDragStore } from '@/stores/drag-store';

interface GhostCardProps {
  visible: boolean;
  children: ReactNode;
  /**
   * Override ghost position/size. When omitted the component reads directly
   * from the drag store so LibraryPage doesn't re-render on every pixel.
   * These overrides are useful in unit tests where wiring the store is
   * unnecessary overhead.
   */
  x?: number;
  y?: number;
  width?: number;
}

const ghostStyle: CSSProperties = {
  position: 'fixed',
  background: 'var(--color-ghost-bg)',
  border: '1px solid var(--color-border-ghost)',
  boxShadow: '0 24px 64px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.06)',
  borderRadius: 'var(--radius-card)',
  pointerEvents: 'none',
  zIndex: 9999,
  touchAction: 'none',
};

/**
 * Ghost card that floats over the list during drag.
 *
 * Subscribes to ghostX/ghostY/ghostWidth directly from the drag store so that
 * LibraryPage (and all its children) don't re-render on every pixel of
 * movement — only this component does.
 */
export function GhostCard({
  visible,
  children,
  x: xProp,
  y: yProp,
  width: widthProp,
}: GhostCardProps) {
  // These update on every touchmove — keep them isolated here so the parent
  // page doesn't re-render for every pixel of movement.
  const storeX = useDragStore((s) => s.ghostX);
  const storeY = useDragStore((s) => s.ghostY);
  const storeWidth = useDragStore((s) => s.ghostWidth);

  const ghostX = xProp ?? storeX;
  const ghostY = yProp ?? storeY;
  const ghostWidth = widthProp ?? storeWidth;

  return createPortal(
    <AnimatePresence>
      {visible && (
        <motion.div
          style={{
            ...ghostStyle,
            left: ghostX,
            top: ghostY,
            width: ghostWidth,
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          data-testid="ghost-card"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
