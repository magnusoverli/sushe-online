/**
 * SortableAlbumList - Drag-and-drop reorderable album list using dnd-kit.
 *
 * Wraps AlbumCard items in a sortable context with:
 * - Long-press (250ms) touch activation for mobile
 * - Auto-scrolling during drag near viewport edges
 * - Haptic feedback on drag start (where supported)
 * - Visual lift on the dragged item (scale + shadow)
 * - Debounced reorder API call after drop
 *
 * Only used when sortKey === 'custom' — other sort modes render a plain list.
 */

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  DndContext,
  closestCenter,
  TouchSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { REORDER_DEBOUNCE_MS, HAPTIC_DURATION_MS } from '@/lib/constants';

// ── Sortable item wrapper ──

interface SortableItemProps {
  id: string;
  children: ReactNode;
}

function SortableItem({ id, children }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    position: 'relative',
    zIndex: isDragging ? 999 : 0,
    opacity: isDragging ? 0.92 : 1,
    ...(isDragging
      ? {
          scale: '1.02',
          boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
          borderRadius: 'var(--radius-card)',
          background: 'var(--color-card-hover)',
        }
      : {}),
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

// ── Main sortable list ──

interface SortableAlbumListProps {
  /** Album IDs in current order (used as sortable item IDs). */
  items: string[];
  /** Called after a drag-and-drop reorder with the new ordered ID array. */
  onReorder: (newOrder: string[]) => void;
  /** Render function for each album by its ID and index. */
  renderItem: (id: string, index: number) => ReactNode;
}

export function SortableAlbumList({
  items,
  onReorder,
  renderItem,
}: SortableAlbumListProps) {
  // Local order state — kept in sync with the items prop, but updated live
  // during drag via onDragOver. This keeps the DOM order in sync with the
  // visual order throughout the drag, so when dnd-kit clears transforms on
  // drop there is no position to snap back from — every item is already in
  // its correct DOM slot.
  const [localOrder, setLocalOrder] = useState(items);
  useEffect(() => {
    setLocalOrder(items);
  }, [items]);

  // Long-press touch sensor: 250ms delay, 5px tolerance
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: {
      delay: 250,
      tolerance: 5,
    },
  });
  const sensors = useSensors(touchSensor);

  // dnd-kit auto-scroll config: threshold is a fraction (0–1) of the
  // scrollable ancestor's size that defines the edge zone.
  const autoScrollConfig = useMemo(
    () => ({
      threshold: { x: 0, y: 0.1 },
      acceleration: 10,
    }),
    []
  );

  const handleDragStart = useCallback((_event: DragStartEvent) => {
    // Haptic feedback
    if (navigator.vibrate) {
      navigator.vibrate(HAPTIC_DURATION_MS);
    }
  }, []);

  // Live reorder: update localOrder as the dragged item crosses neighbours.
  // This moves items in the actual DOM during the drag so they are always in
  // their correct slot. When dnd-kit removes transforms on drop, every item
  // is already where it belongs — no flash.
  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setLocalOrder((prev) => {
      const oldIndex = prev.indexOf(String(active.id));
      const newIndex = prev.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) {
        // Dropped back in original position or cancelled — persist current
        // localOrder only if it diverged from items (prior onDragOver moves)
        if (localOrder !== items) onReorder(localOrder);
        return;
      }

      // Final move (may be redundant if onDragOver already placed it, but
      // ensures correctness for edge cases where the last over fires here)
      const oldIndex = localOrder.indexOf(String(active.id));
      const newIndex = localOrder.indexOf(String(over.id));
      let finalOrder = localOrder;
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        finalOrder = arrayMove(localOrder, oldIndex, newIndex);
        setLocalOrder(finalOrder);
      }

      // Notify parent for persistence (cache update + debounced API save)
      onReorder(finalOrder);
    },
    [items, localOrder, onReorder]
  );

  const handleDragCancel = useCallback(() => {
    // Revert to the prop order on cancel
    setLocalOrder(items);
  }, [items]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      autoScroll={autoScrollConfig}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext
        items={localOrder}
        strategy={verticalListSortingStrategy}
      >
        <div
          role="list"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-card-gap-outer)',
            padding: '0 var(--space-list-x)',
            position: 'relative',
            zIndex: 0,
          }}
          data-testid="album-list"
        >
          {localOrder.map((id, index) => (
            <SortableItem key={id} id={id}>
              {renderItem(id, index)}
            </SortableItem>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

// ── Debounced reorder hook ──

/**
 * Returns a stable callback that debounces calls to the provided save function.
 * On unmount or listId change, any pending save is flushed immediately.
 */
export function useDebouncedReorder(
  saveFn: (listId: string, order: string[]) => Promise<unknown>,
  listId: string | null
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{ listId: string; order: string[] } | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (pendingRef.current) {
      const { listId: id, order } = pendingRef.current;
      pendingRef.current = null;
      saveFn(id, order);
    }
  }, [saveFn]);

  // Flush on listId change or unmount
  useEffect(() => {
    return () => flush();
  }, [listId, flush]);

  const debouncedSave = useCallback(
    (id: string, order: string[]) => {
      pendingRef.current = { listId: id, order };
      if (timerRef.current != null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, REORDER_DEBOUNCE_MS);
    },
    [flush]
  );

  return debouncedSave;
}
