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
import { motion, AnimatePresence } from 'framer-motion';

interface GhostCardProps {
  visible: boolean;
  x: number;
  y: number;
  width: number;
  children: ReactNode;
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

export function GhostCard({ visible, x, y, width, children }: GhostCardProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          style={{
            ...ghostStyle,
            left: x,
            top: y,
            width,
          }}
          initial={{ scale: 1, rotate: 0, opacity: 0 }}
          animate={{ scale: 1.05, rotate: -1.5, opacity: 1 }}
          exit={{ scale: 1, rotate: 0, opacity: 0 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          data-testid="ghost-card"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
