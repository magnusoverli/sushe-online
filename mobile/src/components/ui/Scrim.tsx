/**
 * Scrim - Overlay backdrop for drawers, sheets, context menus.
 *
 * Spec (page 9, 15):
 * - Background: rgba(0,0,0,0.65)
 * - Backdrop filter: blur(2px) (optional, degrades gracefully)
 * - Position: fixed inset 0
 * - Z-index: 300
 * - Tap to dismiss
 * - Fade animation: opacity 0→1 200ms ease enter, 0 180ms ease exit
 */

import { useCallback, useEffect, type CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ScrimProps {
  visible: boolean;
  onDismiss: () => void;
  zIndex?: number;
  className?: string;
  /** Optional bottom offset (e.g. to stop above TabBar). */
  bottom?: string;
}

const baseStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'var(--color-scrim)',
  backdropFilter: 'blur(2px)',
  WebkitBackdropFilter: 'blur(2px)',
};

export function Scrim({
  visible,
  onDismiss,
  zIndex = 300,
  className,
  bottom,
}: ScrimProps) {
  // Close on Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    },
    [onDismiss]
  );

  useEffect(() => {
    if (visible) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [visible, handleKeyDown]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className={className}
          style={{
            ...baseStyle,
            zIndex,
            ...(bottom
              ? { inset: undefined, top: 0, left: 0, right: 0, bottom }
              : {}),
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          onClick={onDismiss}
          aria-hidden="true"
          data-testid="scrim"
        />
      )}
    </AnimatePresence>
  );
}
