/**
 * Toast - Lightweight notification system.
 *
 * Shows temporary notifications at the bottom of the screen (above TabBar).
 * Uses a Zustand store for state so any component can trigger toasts.
 */

import { useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { create } from 'zustand';

type ToastType = 'success' | 'error' | 'info';

interface ToastState {
  message: string | null;
  type: ToastType;
  duration: number;
  show: (message: string, type?: ToastType, duration?: number) => void;
  clear: () => void;
}

export const useToastStore = create<ToastState>()((set) => ({
  message: null,
  type: 'info' as ToastType,
  duration: 3000,
  show: (message: string, type: ToastType = 'info', duration = 3000) =>
    set({ message, type, duration }),
  clear: () => set({ message: null }),
}));

/** Compute auto-duration based on message length: 50ms per char, clamped to [2000, 10000]. */
function autoDuration(message: string): number {
  return Math.min(10000, Math.max(2000, message.length * 50));
}

/** Convenience function — call from anywhere without hooks. */
export function showToast(
  message: string,
  type: ToastType = 'info',
  duration?: number
) {
  useToastStore
    .getState()
    .show(message, type, duration ?? autoDuration(message));
}

const typeColors: Record<ToastType, string> = {
  success: 'rgba(76, 175, 80, 0.95)',
  error: 'rgba(224, 92, 92, 0.95)',
  info: 'rgba(30, 30, 36, 0.95)',
};

export function ToastContainer() {
  const message = useToastStore((s) => s.message);
  const type = useToastStore((s) => s.type);
  const duration = useToastStore((s) => s.duration);
  const clear = useToastStore((s) => s.clear);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => clear(), duration);
  }, [duration, clear]);

  useEffect(() => {
    if (message) startTimer();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [message, startTimer]);

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.2 }}
          style={{
            position: 'fixed',
            bottom: 'calc(var(--tab-bar-height, 56px) + 12px)',
            left: '16px',
            right: '16px',
            zIndex: 500,
            display: 'flex',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
          data-testid="toast"
        >
          <div
            style={{
              background: typeColors[type],
              borderRadius: '10px',
              padding: '10px 16px',
              fontFamily: 'var(--font-mono)',
              fontSize: '9px',
              color: '#fff',
              maxWidth: '320px',
              textAlign: 'center',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            {message}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
