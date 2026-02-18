/**
 * ConfirmDialog - Modal confirmation dialog.
 *
 * Used for destructive actions (delete list, delete collection).
 * Renders centered over the viewport with a scrim backdrop.
 */

import { type ReactNode, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Scrim } from './Scrim';

interface ConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string | ReactNode;
  warning?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Optional extra content (e.g. a checkbox) */
  children?: ReactNode;
  /** Disable confirm button (e.g. until checkbox is checked) */
  confirmDisabled?: boolean;
}

const dialogEasing: [number, number, number, number] = [0.32, 0.72, 0, 1];

export function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  message,
  warning,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = true,
  children,
  confirmDisabled = false,
}: ConfirmDialogProps) {
  const handleConfirm = useCallback(() => {
    if (!confirmDisabled) onConfirm();
  }, [onConfirm, confirmDisabled]);

  return (
    <>
      <Scrim visible={open} onDismiss={onCancel} zIndex={450} />
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2, ease: dialogEasing }}
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 460,
              width: 'calc(100% - 48px)',
              maxWidth: '320px',
              background: 'var(--color-sheet-bg)',
              borderRadius: '16px',
              border: '1px solid rgba(255,255,255,0.08)',
              padding: '20px',
              boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
            }}
            data-testid="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-label={title}
          >
            {/* Title */}
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '15px',
                color: 'var(--color-text-primary)',
                marginBottom: '8px',
              }}
            >
              {title}
            </div>

            {/* Message */}
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '9px',
                lineHeight: '1.5',
                color: 'var(--color-text-secondary)',
                marginBottom: warning || children ? '8px' : '20px',
              }}
            >
              {message}
            </div>

            {/* Warning */}
            {warning && (
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '8px',
                  color: 'var(--color-destructive)',
                  marginBottom: children ? '8px' : '20px',
                }}
                data-testid="confirm-warning"
              >
                {warning}
              </div>
            )}

            {/* Extra content (checkbox, etc.) */}
            {children && <div style={{ marginBottom: '20px' }}>{children}</div>}

            {/* Buttons */}
            <div
              style={{
                display: 'flex',
                gap: '8px',
                justifyContent: 'flex-end',
              }}
            >
              <button
                type="button"
                onClick={onCancel}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '9px',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.10)',
                  background: 'transparent',
                  color: 'var(--color-text-secondary)',
                  cursor: 'pointer',
                }}
                data-testid="confirm-cancel"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={confirmDisabled}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '9px',
                  fontWeight: 500,
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: 'none',
                  background: destructive
                    ? 'var(--color-destructive)'
                    : 'var(--color-gold)',
                  color: destructive ? '#fff' : '#1A1A1F',
                  cursor: confirmDisabled ? 'not-allowed' : 'pointer',
                  opacity: confirmDisabled ? 0.4 : 1,
                }}
                data-testid="confirm-confirm"
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
