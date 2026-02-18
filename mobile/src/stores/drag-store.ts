/**
 * Drag Store - Zustand store for drag-and-drop reorder state.
 *
 * Separated from app-store to keep concerns isolated and
 * allow the drag system to update at high frequency without
 * re-rendering unrelated parts of the UI.
 */

import { create } from 'zustand';

interface DragState {
  /** Whether a drag operation is active. */
  isDragging: boolean;

  /** Index of the item currently being dragged (in the original list). */
  dragIndex: number | null;

  /** Current insertion index (where the item would land if dropped). */
  dropIndex: number | null;

  /** Ghost card position (viewport coordinates). */
  ghostX: number;
  ghostY: number;

  /** Ghost card dimensions (captured from source element). */
  ghostWidth: number;

  /** The current ordered list of _id values (mutated during drag). */
  orderedIds: string[];

  // Actions
  startDrag: (params: {
    index: number;
    ghostX: number;
    ghostY: number;
    ghostWidth: number;
    orderedIds: string[];
  }) => void;
  updateGhost: (x: number, y: number) => void;
  updateDrop: (dropIndex: number, orderedIds: string[]) => void;
  endDrag: () => void;
}

const initialState = {
  isDragging: false,
  dragIndex: null as number | null,
  dropIndex: null as number | null,
  ghostX: 0,
  ghostY: 0,
  ghostWidth: 0,
  orderedIds: [] as string[],
};

export const useDragStore = create<DragState>((set) => ({
  ...initialState,

  startDrag: ({ index, ghostX, ghostY, ghostWidth, orderedIds }) =>
    set({
      isDragging: true,
      dragIndex: index,
      dropIndex: index,
      ghostX,
      ghostY,
      ghostWidth,
      orderedIds,
    }),

  updateGhost: (ghostX, ghostY) => set({ ghostX, ghostY }),

  updateDrop: (dropIndex, orderedIds) => set({ dropIndex, orderedIds }),

  endDrag: () => set(initialState),
}));
