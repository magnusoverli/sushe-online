/**
 * SortableAlbumCard - Wrapper that makes an album card sortable via @dnd-kit.
 *
 * Uses the useSortable hook to provide:
 * - CSS transform-based repositioning (no layout thrashing)
 * - Transition animations for smooth card shuffling
 * - Ref registration for collision detection
 * - Touch/keyboard listeners for drag initiation
 */

import { type CSSProperties, type ReactNode, useMemo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface SortableAlbumCardProps {
  /** Unique ID for this sortable item (album._id). */
  id: string;
  /** Whether this item is currently being dragged (via DragOverlay). */
  isOverlay?: boolean;
  /** The ID of the currently active (dragged) item, or null. */
  activeId: string | null;
  children: ReactNode;
}

export function SortableAlbumCard({
  id,
  isOverlay = false,
  activeId,
  children,
}: SortableAlbumCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = useMemo<CSSProperties>(() => {
    const base: CSSProperties = {
      transform: CSS.Transform.toString(transform),
      transition,
      // The source card becomes invisible while DragOverlay shows the ghost
      opacity: isDragging ? 0.3 : 1,
      // Dimmed appearance for non-active cards during drag
      ...(activeId && !isDragging && !isOverlay
        ? { filter: 'brightness(0.7)' }
        : {}),
      // Prevent long-press context menu on mobile
      WebkitTouchCallout: 'none',
      touchAction: 'manipulation',
    };
    return base;
  }, [transform, transition, isDragging, activeId, isOverlay]);

  // Overlay cards don't need sortable wiring
  if (isOverlay) {
    return (
      <div
        style={{
          background: 'var(--color-ghost-bg)',
          border: '1px solid var(--color-border-ghost)',
          boxShadow:
            '0 24px 64px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.06)',
          borderRadius: 'var(--radius-card)',
          pointerEvents: 'none',
        }}
      >
        {children}
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}
