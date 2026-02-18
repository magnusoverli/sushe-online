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
 * - Auto-scroll near edges (60px zone, 8px/frame max)
 * - Scroll lock (overflow hidden) during drag
 * - Haptic feedback (navigator.vibrate(50)) on activation
 * - Debounced reorder save on drop (500ms)
 */

import { useRef, useCallback, useEffect } from 'react';
import { useDragStore } from '@/stores/drag-store';
import { calcScrollSpeed, startAutoScroll } from './auto-scroll';
import { DRAG_LONG_PRESS_MS, HAPTIC_DURATION_MS } from '@/lib/constants';

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
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
}

/**
 * Determine the new drop index by checking only the immediate neighbors
 * of the current drop position (one step at a time).
 *
 * Why neighbor-only?
 * Scanning all cards causes oscillation: after a swap the relocated card's
 * midpoint lands right at the ghost center, so the very next frame swaps
 * back, creating rapid flickering. With neighbor-only checking:
 * - Moving down: ghost center must cross the NEXT card's midpoint.
 * - Moving up:   ghost center must cross the PREVIOUS card's midpoint.
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

  // Move down: ghost center past the next card's midpoint
  if (currentDropIndex < n - 1) {
    const nextEl = cardElements[currentDropIndex + 1];
    if (nextEl) {
      const rect = nextEl.getBoundingClientRect();
      if (ghostCenterY > rect.top + rect.height / 2) {
        return currentDropIndex + 1;
      }
    }
  }

  // Move up: ghost center above the previous card's midpoint
  if (currentDropIndex > 0) {
    const prevEl = cardElements[currentDropIndex - 1];
    if (prevEl) {
      const rect = prevEl.getBoundingClientRect();
      if (ghostCenterY < rect.top + rect.height / 2) {
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
  // Native non-passive touchmove handler ref (attached on drag start to
  // reliably call preventDefault regardless of React's event passivity)
  const nativePreventScroll = useRef<((e: TouchEvent) => void) | null>(null);

  // Store actions (avoid subscribing to state in the hook itself)
  const startDrag = useDragStore((s) => s.startDrag);
  const updateGhost = useDragStore((s) => s.updateGhost);
  const updateDrop = useDragStore((s) => s.updateDrop);
  const endDragAction = useDragStore((s) => s.endDrag);

  // Register card element refs
  const registerCard = useCallback((index: number, el: HTMLElement | null) => {
    cardRefs.current[index] = el;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      if (stopAutoScroll.current) stopAutoScroll.current();
      if (nativePreventScroll.current) {
        document.removeEventListener('touchmove', nativePreventScroll.current);
        nativePreventScroll.current = null;
      }
      if (scrollContainerRef.current) {
        scrollContainerRef.current.style.touchAction = '';
      }
      document.body.style.overflow = '';
    };
  }, [scrollContainerRef]);

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

      // Capture card height for ghost-center computation in onTouchMove
      dragCardHeight.current = rect.height;

      // Calculate offset from touch point to card top-left
      touchOffset.current = {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      };

      const ghostX = touch.clientX - touchOffset.current.x;
      const ghostY = touch.clientY - touchOffset.current.y;

      dragOriginIndex.current = index;
      currentOrderRef.current = [...itemIds];

      // Attach a native non-passive touchmove listener on document so we can
      // reliably call preventDefault() during drag. React's synthetic
      // onTouchMove may be passive in some environments (silently ignoring
      // preventDefault), and directly setting overflow: hidden on the scroll
      // container breaks iOS Safari's -webkit-overflow-scrolling: touch,
      // causing scroll to stop working after the drag ends.
      const preventScroll = (e: TouchEvent) => {
        if (e.cancelable) e.preventDefault();
      };
      nativePreventScroll.current = preventScroll;
      document.addEventListener('touchmove', preventScroll, { passive: false });

      // Lock touchAction on the container so the browser doesn't commit to a
      // new pan gesture mid-drag. We intentionally do NOT touch overflow here
      // to avoid the -webkit-overflow-scrolling: touch Safari bug.
      if (scrollContainerRef.current) {
        scrollContainerRef.current.style.touchAction = 'none';
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
        orderedIds: [...itemIds],
      });

      // Start auto-scroll
      const container = scrollContainerRef.current;
      if (container) {
        stopAutoScroll.current = startAutoScroll(
          container,
          () => currentSpeed.current
        );
      }
    },
    [itemIds, startDrag, scrollContainerRef]
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
    },
    [enabled, activateDrag]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;

      const isDragging = useDragStore.getState().isDragging;

      // If not yet dragging, check if we should cancel the long-press
      if (!isDragging) {
        if (touchStart.current) {
          const dx = touch.clientX - touchStart.current.x;
          const dy = touch.clientY - touchStart.current.y;
          if (Math.sqrt(dx * dx + dy * dy) > MOVE_CANCEL_THRESHOLD) {
            cancelLongPress();
          }
        }
        return;
      }

      // Prevent default via React synthetic event (may be passive — the
      // native document listener above is the reliable fallback)
      if (e.cancelable) e.preventDefault();

      // Update ghost position
      const ghostX = touch.clientX - touchOffset.current.x;
      const ghostY = touch.clientY - touchOffset.current.y;
      updateGhost(ghostX, ghostY);

      // Calculate auto-scroll speed
      const container = scrollContainerRef.current;
      if (container) {
        const containerRect = container.getBoundingClientRect();
        currentSpeed.current = calcScrollSpeed(
          touch.clientY,
          containerRect.top,
          containerRect.bottom
        );
      }

      // Compute the ghost card's center Y in viewport space.
      // Using the center (rather than raw touch.clientY) makes swap thresholds
      // symmetric and gives natural hysteresis after each swap.
      const ghostCenterY =
        touch.clientY - touchOffset.current.y + dragCardHeight.current / 2;

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
        // Re-derive order from the original list order by moving the dragged
        // item from its origin to the new drop position.
        const newOrder = moveItem(
          currentOrderRef.current,
          currentOrderRef.current.indexOf(itemIds[dragOriginIndex.current]!),
          newDropIndex
        );
        updateDrop(newDropIndex, newOrder);
      }
    },
    [cancelLongPress, updateGhost, updateDrop, scrollContainerRef, itemIds]
  );

  const onTouchEnd = useCallback(() => {
    cancelLongPress();

    const state = useDragStore.getState();
    if (!state.isDragging) return;

    // Stop auto-scroll
    if (stopAutoScroll.current) {
      stopAutoScroll.current();
      stopAutoScroll.current = null;
    }
    currentSpeed.current = 0;

    // Remove native scroll-prevention listener
    if (nativePreventScroll.current) {
      document.removeEventListener('touchmove', nativePreventScroll.current);
      nativePreventScroll.current = null;
    }

    // Restore touchAction on scroll container and body
    if (scrollContainerRef.current) {
      scrollContainerRef.current.style.touchAction = '';
    }
    document.body.style.overflow = '';

    // Notify parent of new order
    const finalOrder = state.orderedIds;
    endDragAction();

    // Only call onReorder if the order actually changed
    if (
      finalOrder.length > 0 &&
      !finalOrder.every((id, i) => id === itemIds[i])
    ) {
      onReorder(finalOrder);
    }

    dragOriginIndex.current = null;
    touchStart.current = null;
  }, [cancelLongPress, endDragAction, onReorder, itemIds]);

  return {
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
    registerCard,
  };
}
