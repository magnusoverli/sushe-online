import { describe, it, expect, beforeEach } from 'vitest';
import { useDragStore } from '../drag-store';

describe('drag-store', () => {
  beforeEach(() => {
    // Reset store to initial state
    useDragStore.getState().endDrag();
  });

  it('starts in non-dragging state', () => {
    const state = useDragStore.getState();
    expect(state.isDragging).toBe(false);
    expect(state.dragIndex).toBeNull();
    expect(state.dropIndex).toBeNull();
    expect(state.orderedIds).toEqual([]);
  });

  it('startDrag activates dragging state', () => {
    useDragStore.getState().startDrag({
      index: 2,
      ghostX: 100,
      ghostY: 200,
      ghostWidth: 350,
      orderedIds: ['a', 'b', 'c', 'd'],
    });

    const state = useDragStore.getState();
    expect(state.isDragging).toBe(true);
    expect(state.dragIndex).toBe(2);
    expect(state.dropIndex).toBe(2);
    expect(state.ghostX).toBe(100);
    expect(state.ghostY).toBe(200);
    expect(state.ghostWidth).toBe(350);
    expect(state.orderedIds).toEqual(['a', 'b', 'c', 'd']);
  });

  it('updateGhost moves ghost position', () => {
    useDragStore.getState().startDrag({
      index: 0,
      ghostX: 0,
      ghostY: 0,
      ghostWidth: 300,
      orderedIds: ['a', 'b'],
    });

    useDragStore.getState().updateGhost(50, 75);

    const state = useDragStore.getState();
    expect(state.ghostX).toBe(50);
    expect(state.ghostY).toBe(75);
  });

  it('updateDrop changes drop index and ordered IDs', () => {
    useDragStore.getState().startDrag({
      index: 0,
      ghostX: 0,
      ghostY: 0,
      ghostWidth: 300,
      orderedIds: ['a', 'b', 'c'],
    });

    useDragStore.getState().updateDrop(2, ['b', 'c', 'a']);

    const state = useDragStore.getState();
    expect(state.dropIndex).toBe(2);
    expect(state.orderedIds).toEqual(['b', 'c', 'a']);
  });

  it('endDrag resets to initial state', () => {
    useDragStore.getState().startDrag({
      index: 1,
      ghostX: 100,
      ghostY: 200,
      ghostWidth: 350,
      orderedIds: ['a', 'b', 'c'],
    });

    useDragStore.getState().endDrag();

    const state = useDragStore.getState();
    expect(state.isDragging).toBe(false);
    expect(state.dragIndex).toBeNull();
    expect(state.dropIndex).toBeNull();
    expect(state.ghostX).toBe(0);
    expect(state.ghostY).toBe(0);
    expect(state.ghostWidth).toBe(0);
    expect(state.orderedIds).toEqual([]);
  });
});
