/**
 * SortableAlbumList - @dnd-kit powered sortable container for album cards.
 *
 * Replaces the custom drag-and-drop system with @dnd-kit's battle-tested
 * sortable preset. Handles:
 * - Touch activation with configurable long-press delay
 * - Built-in auto-scrolling near container edges
 * - Collision detection via closestCenter
 * - CSS transform-based card shuffling (no layout thrashing)
 * - Keyboard accessibility
 */

import { useState, useCallback, useMemo, type ReactNode } from 'react';
import {
  DndContext,
  closestCenter,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { HAPTIC_DURATION_MS } from '@/lib/constants';

/** Long-press delay (ms) before drag activates on touch. */
const TOUCH_ACTIVATION_DELAY = 300;

/** Finger movement tolerance (px) during the long-press delay. */
const TOUCH_ACTIVATION_TOLERANCE = 8;

interface SortableAlbumListProps {
  /** Ordered list of unique item IDs (album._id values). */
  itemIds: string[];
  /** Called with the new ordered ID array after a successful reorder. */
  onReorder: (newOrder: string[]) => void;
  /** Whether drag-and-drop is enabled (e.g. only in custom sort mode). */
  enabled?: boolean;
  /** Render the list items. Receives activeId so items can style themselves. */
  children: (activeId: string | null) => ReactNode;
}

export function SortableAlbumList({
  itemIds,
  onReorder,
  enabled = true,
  children,
}: SortableAlbumListProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: TOUCH_ACTIVATION_DELAY,
        tolerance: TOUCH_ACTIVATION_TOLERANCE,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    // Haptic feedback on activation
    if (navigator.vibrate) {
      navigator.vibrate(HAPTIC_DURATION_MS);
    }
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);

      if (over && active.id !== over.id) {
        const oldIndex = itemIds.indexOf(String(active.id));
        const newIndex = itemIds.indexOf(String(over.id));
        if (oldIndex !== -1 && newIndex !== -1) {
          const newOrder = arrayMove(itemIds, oldIndex, newIndex);
          onReorder(newOrder);
        }
      }
    },
    [itemIds, onReorder]
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
  }, []);

  // When disabled, render children without DndContext wrapper
  const stableItemIds = useMemo(() => itemIds, [itemIds]);

  if (!enabled) {
    return <>{children(null)}</>;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext
        items={stableItemIds}
        strategy={verticalListSortingStrategy}
      >
        {children(activeId)}
      </SortableContext>
    </DndContext>
  );
}
