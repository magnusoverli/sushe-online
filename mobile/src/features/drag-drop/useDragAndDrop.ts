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
 * Get the index of the card element at a given Y coordinate.
 * Uses the stored card refs to find which card the touch is over.
 */
function findDropIndex(
  touchY: number,
  cardElements: (HTMLElement | null)[],
  scrollContainer: HTMLElement | null
): number | null {
  if (!scrollContainer) return null;

  for (let i = 0; i < cardElements.length; i++) {
    const el = cardElements[i];
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (touchY < midY) return i;
  }
  // If past all cards, return last index
  return cardElements.length > 0 ? cardElements.length - 1 : null;
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
  const currentSpeed = useRef(0);
  const stopAutoScroll = useRef<(() => void) | null>(null);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);
  const dragOriginIndex = useRef<number | null>(null);
  const currentOrderRef = useRef<string[]>([]);

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
      document.body.style.overflow = '';
    };
  }, []);

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

      // Calculate offset from touch point to card top-left
      touchOffset.current = {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      };

      const ghostX = touch.clientX - touchOffset.current.x;
      const ghostY = touch.clientY - touchOffset.current.y;

      dragOriginIndex.current = index;
      currentOrderRef.current = [...itemIds];

      // Lock body scroll
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

      // Prevent default to stop page scroll while dragging
      e.preventDefault();

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

      // Find which card we're over and update drop index
      const newDropIndex = findDropIndex(
        touch.clientY,
        cardRefs.current,
        scrollContainerRef.current
      );

      if (newDropIndex !== null && dragOriginIndex.current !== null) {
        const state = useDragStore.getState();
        if (newDropIndex !== state.dropIndex) {
          // Re-derive order from the original order: move the dragged item
          // from its origin to the new drop position
          const newOrder = moveItem(
            currentOrderRef.current,
            currentOrderRef.current.indexOf(itemIds[dragOriginIndex.current]!),
            newDropIndex
          );
          updateDrop(newDropIndex, newOrder);
        }
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

    // Unlock body scroll
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
