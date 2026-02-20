/**
 * useDragAndDrop - Custom hook for touch-based drag-and-drop reordering.
 *
 * Spec (Phase 7):
 * - 480ms long-press to activate (cancel if finger moves > 10px)
 * - Ghost card follows touch with offset anchoring
 * - Source card dims to 0.2 opacity, scale(0.97)
 * - Non-active cards dim to 0.55 opacity
 * - Drop target highlights with bg/border
 * - Real-time list shuffling during drag
 * - Auto-scroll near edges (proportional zone, 12px/frame max)
 * - Scroll lock (overflow hidden) during drag
 * - Haptic feedback (navigator.vibrate(50)) on activation
 * - Debounced reorder save on drop (500ms)
 */

import { useRef, useCallback, useEffect } from 'react';
import { useDragStore } from '@/stores/drag-store';
import { calcScrollSpeed, startAutoScroll } from './auto-scroll';
import { freezeViewport, unfreezeViewport } from '@/hooks/useViewport';
import {
  DRAG_LONG_PRESS_MS,
  DRAG_SWAP_THRESHOLD,
  HAPTIC_DURATION_MS,
} from '@/lib/constants';

/** Movement threshold (px) to cancel long-press. */
const MOVE_CANCEL_THRESHOLD = 10;

interface UseDragAndDropOptions {
  /** The ordered list of item IDs (_id values). */
  itemIds: string[];
  /** Called when the order changes (after drop). */
  onReorder: (newOrder: string[]) => void;
  /** Whether drag is enabled (e.g., only in custom sort). */
  enabled?: boolean;
  /** Ref to the scroll container (for auto-scroll). */
  scrollContainerRef: React.RefObject<HTMLElement | null>;
}

interface DragHandlers {
  onTouchStart: (index: number, e: React.TouchEvent) => void;
}

/**
 * Determine the new drop index by checking only the immediate neighbors
 * of the current drop position (one step at a time).
 *
 * Why neighbor-only?
 * Scanning all cards causes oscillation: after a swap the relocated card's
 * midpoint lands right at the ghost center, so the very next frame swaps
 * back, creating rapid flickering. With neighbor-only checking:
 * - Moving down: ghost center must cross the NEXT card's threshold.
 * - Moving up:   ghost center must cross the PREVIOUS card's threshold.
 * After a swap the relocated card is now a full card-height away, making an
 * immediate reverse-swap impossible. Hysteresis is free.
 *
 * The ghost center (not raw touch Y) is used so that the threshold is
 * symmetric regardless of where on the card the user first grabbed.
 */
function findDropIndex(
  ghostCenterY: number,
  cardElements: (HTMLElement | null)[],
  currentDropIndex: number | null,
  scrollContainer: HTMLElement | null
): number | null {
  if (!scrollContainer || currentDropIndex === null) return currentDropIndex;

  const n = cardElements.length;

  // Move down: swap when ghost center crosses the threshold of the next card
  if (currentDropIndex < n - 1) {
    const nextEl = cardElements[currentDropIndex + 1];
    if (nextEl) {
      const rect = nextEl.getBoundingClientRect();
      if (ghostCenterY > rect.top + rect.height * DRAG_SWAP_THRESHOLD) {
        return currentDropIndex + 1;
      }
    }
  }

  // Move up: swap when ghost center crosses the threshold of the previous card
  if (currentDropIndex > 0) {
    const prevEl = cardElements[currentDropIndex - 1];
    if (prevEl) {
      const rect = prevEl.getBoundingClientRect();
      if (ghostCenterY < rect.bottom - rect.height * DRAG_SWAP_THRESHOLD) {
        return currentDropIndex - 1;
      }
    }
  }

  // No swap needed
  return currentDropIndex;
}

/**
 * Reorder an array by moving an item from one index to another.
 */
function moveItem<T>(arr: T[], fromIndex: number, toIndex: number): T[] {
  const result = [...arr];
  const [item] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, item!);
  return result;
}

export function useDragAndDrop({
  itemIds,
  onReorder,
  enabled = true,
  scrollContainerRef,
}: UseDragAndDropOptions): {
  handlers: DragHandlers;
  registerCard: (index: number, el: HTMLElement | null) => void;
} {
  // Refs for long-press detection
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const touchOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragCardHeight = useRef<number>(0);
  const currentSpeed = useRef(0);
  const stopAutoScroll = useRef<(() => void) | null>(null);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);
  const dragOriginIndex = useRef<number | null>(null);
  const currentOrderRef = useRef<string[]>([]);
  /** Snapshotted scroll container bounds, frozen at drag start. */
  const containerBounds = useRef<{ top: number; bottom: number } | null>(null);

  // Refs to avoid stale closures in native document-level listeners.
  // Updated every render so the native handlers always read the latest values.
  const itemIdsRef = useRef(itemIds);
  itemIdsRef.current = itemIds;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  // Native document-level listener refs.
  // Attached on touchstart (to track pre-drag movement), kept through drag,
  // and cleaned up on touchend/touchcancel or unmount.
  const nativeMoveRef = useRef<((e: TouchEvent) => void) | null>(null);
  const nativeEndRef = useRef<((e: TouchEvent) => void) | null>(null);

  // Store actions (avoid subscribing to state in the hook itself)
  const startDrag = useDragStore((s) => s.startDrag);
  const updateGhost = useDragStore((s) => s.updateGhost);
  const updateDrop = useDragStore((s) => s.updateDrop);
  const endDragAction = useDragStore((s) => s.endDrag);

  // Register card element refs
  const registerCard = useCallback((index: number, el: HTMLElement | null) => {
    cardRefs.current[index] = el;
  }, []);

  /** Remove all native document-level touch listeners. */
  const cleanupNativeListeners = useCallback(() => {
    if (nativeMoveRef.current) {
      document.removeEventListener('touchmove', nativeMoveRef.current);
      nativeMoveRef.current = null;
    }
    if (nativeEndRef.current) {
      document.removeEventListener('touchend', nativeEndRef.current);
      document.removeEventListener('touchcancel', nativeEndRef.current);
      nativeEndRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      if (stopAutoScroll.current) stopAutoScroll.current();
      cleanupNativeListeners();
      if (scrollContainerRef.current) {
        scrollContainerRef.current.style.touchAction = '';
      }
      document.body.style.overflow = '';
      unfreezeViewport();
    };
  }, [scrollContainerRef, cleanupNativeListeners]);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const activateDrag = useCallback(
    (index: number, touch: { clientX: number; clientY: number }) => {
      const cardEl = cardRefs.current[index];
      if (!cardEl) return;

      const rect = cardEl.getBoundingClientRect();

      // Capture card height for ghost-center computation
      dragCardHeight.current = rect.height;

      // Calculate offset from touch point to card top-left
      touchOffset.current = {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      };

      const ghostX = touch.clientX - touchOffset.current.x;
      const ghostY = touch.clientY - touchOffset.current.y;

      dragOriginIndex.current = index;
      currentOrderRef.current = [...itemIdsRef.current];

      // Freeze --vh so Android browser chrome changes (URL bar snapping)
      // don't resize the layout mid-drag.
      freezeViewport();

      // Snapshot container bounds BEFORE locking overflow. On Android
      // Chromium, setting overflow:hidden on body can cause the URL bar
      // to snap back, resizing the viewport and shifting the container.
      // Freezing the bounds at this point avoids displaced trigger zones.
      const container = scrollContainerRef.current;
      if (container) {
        const cRect = container.getBoundingClientRect();
        containerBounds.current = { top: cRect.top, bottom: cRect.bottom };
      }

      // Lock touchAction on the container so the browser doesn't commit to a
      // new pan gesture mid-drag.
      if (container) {
        container.style.touchAction = 'none';
      }
      document.body.style.overflow = 'hidden';

      // Haptic feedback
      if (navigator.vibrate) {
        navigator.vibrate(HAPTIC_DURATION_MS);
      }

      startDrag({
        index,
        ghostX,
        ghostY,
        ghostWidth: rect.width,
        orderedIds: [...itemIdsRef.current],
      });

      // Start auto-scroll (reuse `container` from the snapshot block above)
      if (container) {
        stopAutoScroll.current = startAutoScroll(
          container,
          () => currentSpeed.current
        );
      }
    },
    [startDrag, scrollContainerRef]
  );

  const onTouchStart = useCallback(
    (index: number, e: React.TouchEvent) => {
      if (!enabled) return;

      const touch = e.touches[0];
      if (!touch) return;

      touchStart.current = { x: touch.clientX, y: touch.clientY };

      // Start long-press timer
      longPressTimer.current = setTimeout(() => {
        activateDrag(index, touch);
      }, DRAG_LONG_PRESS_MS);

      // Clean up any lingering listeners from a previous gesture
      cleanupNativeListeners();

      // --- Document-level touchmove handler ---
      // Handles both pre-drag (cancel long-press on movement) and active drag
      // (ghost tracking, auto-scroll, swap detection). Attached with
      // { passive: false } so preventDefault reliably blocks scrolling during
      // drag, working around React's potentially passive synthetic events and
      // iOS Safari's -webkit-overflow-scrolling: touch quirks.
      const handleMove = (ev: TouchEvent) => {
        const t = ev.touches[0];
        if (!t) return;

        const dragging = useDragStore.getState().isDragging;

        if (!dragging) {
          // Pre-drag: cancel long-press if finger moved too far
          if (touchStart.current) {
            const dx = t.clientX - touchStart.current.x;
            const dy = t.clientY - touchStart.current.y;
            if (Math.sqrt(dx * dx + dy * dy) > MOVE_CANCEL_THRESHOLD) {
              cancelLongPress();
              cleanupNativeListeners();
            }
          }
          return;
        }

        // Active drag — prevent browser scroll
        if (ev.cancelable) ev.preventDefault();

        // Update ghost position
        const gx = t.clientX - touchOffset.current.x;
        const gy = t.clientY - touchOffset.current.y;
        updateGhost(gx, gy);

        // Calculate auto-scroll speed using snapshotted container bounds.
        // Using frozen bounds (captured before overflow:hidden) prevents
        // displaced trigger zones on Android when browser chrome resizes.
        if (containerBounds.current) {
          currentSpeed.current = calcScrollSpeed(
            t.clientY,
            containerBounds.current.top,
            containerBounds.current.bottom
          );
        }

        // Compute the ghost card's center Y in viewport space.
        // Using the center (rather than raw touch.clientY) makes swap
        // thresholds symmetric and gives natural hysteresis after each swap.
        const ghostCenterY =
          t.clientY - touchOffset.current.y + dragCardHeight.current / 2;

        const state = useDragStore.getState();

        // Check only the immediate neighbors of the current drop slot.
        // Returns currentDropIndex unchanged if no swap threshold is crossed.
        const newDropIndex = findDropIndex(
          ghostCenterY,
          cardRefs.current,
          state.dropIndex,
          scrollContainerRef.current
        );

        if (
          newDropIndex !== null &&
          newDropIndex !== state.dropIndex &&
          dragOriginIndex.current !== null
        ) {
          const ids = itemIdsRef.current;
          const newOrder = moveItem(
            currentOrderRef.current,
            currentOrderRef.current.indexOf(ids[dragOriginIndex.current]!),
            newDropIndex
          );
          updateDrop(newDropIndex, newOrder);
        }
      };

      // --- Document-level touchend/touchcancel handler ---
      const handleEnd = () => {
        cancelLongPress();
        cleanupNativeListeners();

        const state = useDragStore.getState();
        if (!state.isDragging) return;

        // Stop auto-scroll
        if (stopAutoScroll.current) {
          stopAutoScroll.current();
          stopAutoScroll.current = null;
        }
        currentSpeed.current = 0;

        // Restore touch behavior
        if (scrollContainerRef.current) {
          scrollContainerRef.current.style.touchAction = '';
        }
        document.body.style.overflow = '';
        unfreezeViewport();

        // Notify parent of new order
        const finalOrder = state.orderedIds;
        endDragAction();

        if (
          finalOrder.length > 0 &&
          !finalOrder.every((id, i) => id === itemIdsRef.current[i])
        ) {
          onReorderRef.current(finalOrder);
        }

        dragOriginIndex.current = null;
        touchStart.current = null;
        containerBounds.current = null;
      };

      nativeMoveRef.current = handleMove;
      nativeEndRef.current = handleEnd;
      document.addEventListener('touchmove', handleMove, { passive: false });
      document.addEventListener('touchend', handleEnd);
      document.addEventListener('touchcancel', handleEnd);
    },
    [
      enabled,
      activateDrag,
      cancelLongPress,
      cleanupNativeListeners,
      updateGhost,
      updateDrop,
      endDragAction,
      scrollContainerRef,
    ]
  );

  return {
    handlers: { onTouchStart },
    registerCard,
  };
}
