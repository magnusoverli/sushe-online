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

import {
  type ReactNode,
  type CSSProperties,
  useCallback,
  useRef,
  useState,
  useEffect,
} from 'react';
import { createPortal } from 'react-dom';
import {
  motion,
  AnimatePresence,
  useDragControls,
  type PanInfo,
} from 'framer-motion';
import { Scrim } from './Scrim';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  /** Optional element rendered inline before the title (e.g. a thumbnail) */
  titleIcon?: ReactNode;
  children: ReactNode;
  /** Non-scrollable footer pinned at the bottom of the sheet (e.g. action buttons) */
  footer?: ReactNode;
  /** Override z-index for stacking above other sheets (default: --z-sheet / 400) */
  zIndex?: number;
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
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
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
  fontSize: '17px',
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
  subtitle,
  titleIcon,
  children,
  footer,
  zIndex,
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragControls = useDragControls();
  const [lockedHeight, setLockedHeight] = useState<number | null>(null);

  // Lock the sheet height after the enter animation completes.
  // This prevents the sheet from growing upward when content expands
  // (e.g. inline list picker opens) — new content scrolls internally instead.
  useEffect(() => {
    if (!open) {
      setLockedHeight(null);
      return;
    }

    // Wait for the enter animation (280ms) + one extra frame
    const timer = setTimeout(() => {
      if (sheetRef.current) {
        setLockedHeight(sheetRef.current.getBoundingClientRect().height);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [open]);

  const handleDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      if (info.offset.y > SWIPE_THRESHOLD) {
        onClose();
      }
    },
    [onClose]
  );

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      dragControls.start(e);
    },
    [dragControls]
  );

  return createPortal(
    <>
      <Scrim
        visible={open}
        onDismiss={onClose}
        {...(zIndex != null ? { zIndex: zIndex - 10 } : {})}
      />
      <AnimatePresence>
        {open && (
          <motion.div
            ref={sheetRef}
            style={{
              ...sheetStyle,
              ...(lockedHeight != null ? { height: lockedHeight } : {}),
              ...(zIndex != null ? { zIndex } : {}),
            }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{
              type: 'tween',
              duration: 0.28,
              ease: sheetEasing,
            }}
            drag="y"
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0.3}
            onDragEnd={handleDragEnd}
            data-testid="bottom-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={title || 'Action sheet'}
          >
            {/* Drag handle region (swipe-to-dismiss, non-scrollable) */}
            <div
              style={{ touchAction: 'none', flexShrink: 0, cursor: 'grab' }}
              onPointerDown={startDrag}
            >
              <div style={handleStyle} data-testid="sheet-handle" />

              {/* Title */}
              {title && (
                <div
                  style={{
                    ...titleStyle,
                    ...(titleIcon
                      ? {
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                        }
                      : {}),
                  }}
                >
                  {titleIcon}
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {title}
                    {subtitle && (
                      <div
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '12px',
                          color: 'var(--color-text-primary)',
                          marginTop: '2px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {subtitle}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Scrollable content */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                WebkitOverflowScrolling: 'touch',
                overscrollBehavior: 'contain',
                padding: footer
                  ? '8px 8px 16px'
                  : '8px 8px calc(16px + var(--tabbar-height, 64px) + env(safe-area-inset-bottom, 0px))',
              }}
              className="hide-scrollbar"
            >
              {children}
            </div>

            {/* Non-scrollable footer */}
            {footer && (
              <div
                style={{
                  flexShrink: 0,
                  padding:
                    '8px 8px calc(8px + var(--tabbar-height, 64px) + env(safe-area-inset-bottom, 0px))',
                  borderTop: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                {footer}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body
  );
}
