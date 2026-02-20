import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useDragAndDrop } from '../useDragAndDrop';
import { useDragStore } from '@/stores/drag-store';
import { useRef } from 'react';

// Polyfill Touch for jsdom
if (typeof globalThis.Touch === 'undefined') {
  // @ts-expect-error: Minimal Touch polyfill for tests
  globalThis.Touch = class Touch {
    identifier: number;
    target: EventTarget;
    clientX: number;
    clientY: number;
    pageX: number;
    pageY: number;
    screenX: number;
    screenY: number;
    constructor(init: {
      identifier: number;
      target: EventTarget;
      clientX?: number;
      clientY?: number;
    }) {
      this.identifier = init.identifier;
      this.target = init.target;
      this.clientX = init.clientX ?? 0;
      this.clientY = init.clientY ?? 0;
      this.pageX = this.clientX;
      this.pageY = this.clientY;
      this.screenX = this.clientX;
      this.screenY = this.clientY;
    }
  };
}

// Test component that renders the hook with draggable items
function TestList({
  itemIds,
  onReorder,
  enabled = true,
}: {
  itemIds: string[];
  onReorder: (ids: string[]) => void;
  enabled?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { handlers, registerCard } = useDragAndDrop({
    itemIds,
    onReorder,
    enabled,
    scrollContainerRef: scrollRef,
  });

  return (
    <div ref={scrollRef} data-testid="scroll-container">
      <div data-testid="list">
        {itemIds.map((id, index) => (
          <div
            key={id}
            ref={(el) => registerCard(index, el)}
            onTouchStart={(e) => handlers.onTouchStart(index, e)}
            data-testid={`item-${id}`}
          >
            {id}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Helper to create a synthetic touchstart event */
function createTouchStartEvent(
  target: Element,
  clientX: number,
  clientY: number
) {
  return new TouchEvent('touchstart', {
    bubbles: true,
    cancelable: true,
    touches: [new Touch({ identifier: 0, target, clientX, clientY })],
  });
}

describe('useDragAndDrop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useDragStore.getState().endDrag();
    // Mock navigator.vibrate
    Object.defineProperty(navigator, 'vibrate', {
      value: vi.fn(),
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.style.overflow = '';
  });

  it('renders draggable items', () => {
    render(<TestList itemIds={['a', 'b', 'c']} onReorder={vi.fn()} />);

    expect(screen.getByTestId('item-a')).toBeDefined();
    expect(screen.getByTestId('item-b')).toBeDefined();
    expect(screen.getByTestId('item-c')).toBeDefined();
  });

  it('does not activate drag on short touch', () => {
    render(<TestList itemIds={['a', 'b', 'c']} onReorder={vi.fn()} />);

    const item = screen.getByTestId('item-a');

    act(() => {
      item.dispatchEvent(createTouchStartEvent(item, 100, 50));
    });

    // Advance only 200ms (less than 480ms threshold)
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(useDragStore.getState().isDragging).toBe(false);
  });

  it('activates drag after long press (480ms)', () => {
    render(<TestList itemIds={['a', 'b', 'c']} onReorder={vi.fn()} />);

    const item = screen.getByTestId('item-a');
    vi.spyOn(item, 'getBoundingClientRect').mockReturnValue({
      top: 40,
      left: 10,
      bottom: 90,
      right: 360,
      width: 350,
      height: 50,
      x: 10,
      y: 40,
      toJSON: () => ({}),
    });

    act(() => {
      item.dispatchEvent(createTouchStartEvent(item, 100, 60));
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    const state = useDragStore.getState();
    expect(state.isDragging).toBe(true);
    expect(state.dragIndex).toBe(0);
    expect(state.ghostWidth).toBe(350);
  });

  it('does not start drag when disabled', () => {
    render(
      <TestList itemIds={['a', 'b', 'c']} onReorder={vi.fn()} enabled={false} />
    );

    const item = screen.getByTestId('item-a');

    act(() => {
      item.dispatchEvent(createTouchStartEvent(item, 100, 50));
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(useDragStore.getState().isDragging).toBe(false);
  });

  it('locks body scroll during drag', () => {
    render(<TestList itemIds={['a', 'b', 'c']} onReorder={vi.fn()} />);

    const item = screen.getByTestId('item-a');
    vi.spyOn(item, 'getBoundingClientRect').mockReturnValue({
      top: 40,
      left: 10,
      bottom: 90,
      right: 360,
      width: 350,
      height: 50,
      x: 10,
      y: 40,
      toJSON: () => ({}),
    });

    act(() => {
      item.dispatchEvent(createTouchStartEvent(item, 100, 60));
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(document.body.style.overflow).toBe('hidden');
  });

  it('triggers haptic feedback on drag activation', () => {
    render(<TestList itemIds={['a', 'b', 'c']} onReorder={vi.fn()} />);

    const item = screen.getByTestId('item-a');
    vi.spyOn(item, 'getBoundingClientRect').mockReturnValue({
      top: 40,
      left: 10,
      bottom: 90,
      right: 360,
      width: 350,
      height: 50,
      x: 10,
      y: 40,
      toJSON: () => ({}),
    });

    act(() => {
      item.dispatchEvent(createTouchStartEvent(item, 100, 60));
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(navigator.vibrate).toHaveBeenCalledWith(50);
  });

  it('resets state on touch end', () => {
    render(<TestList itemIds={['a', 'b', 'c']} onReorder={vi.fn()} />);

    const item = screen.getByTestId('item-a');
    vi.spyOn(item, 'getBoundingClientRect').mockReturnValue({
      top: 40,
      left: 10,
      bottom: 90,
      right: 360,
      width: 350,
      height: 50,
      x: 10,
      y: 40,
      toJSON: () => ({}),
    });

    // Start drag
    act(() => {
      item.dispatchEvent(createTouchStartEvent(item, 100, 60));
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(useDragStore.getState().isDragging).toBe(true);

    // End drag — touchend listener is now on document
    act(() => {
      fireEvent.touchEnd(document);
    });

    expect(useDragStore.getState().isDragging).toBe(false);
    expect(document.body.style.overflow).toBe('');
  });

  it('calls onReorder when order changes', () => {
    const onReorder = vi.fn();
    render(<TestList itemIds={['a', 'b', 'c']} onReorder={onReorder} />);

    const item = screen.getByTestId('item-a');
    vi.spyOn(item, 'getBoundingClientRect').mockReturnValue({
      top: 40,
      left: 10,
      bottom: 90,
      right: 360,
      width: 350,
      height: 50,
      x: 10,
      y: 40,
      toJSON: () => ({}),
    });

    // Start drag
    act(() => {
      item.dispatchEvent(createTouchStartEvent(item, 100, 60));
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    // Manually update the order in the store to simulate a drop at a different position
    act(() => {
      useDragStore.getState().updateDrop(2, ['b', 'c', 'a']);
    });

    // End drag — touchend listener is now on document
    act(() => {
      fireEvent.touchEnd(document);
    });

    expect(onReorder).toHaveBeenCalledWith(['b', 'c', 'a']);
  });

  it('does not call onReorder when order is unchanged', () => {
    const onReorder = vi.fn();
    render(<TestList itemIds={['a', 'b', 'c']} onReorder={onReorder} />);

    const item = screen.getByTestId('item-a');
    vi.spyOn(item, 'getBoundingClientRect').mockReturnValue({
      top: 40,
      left: 10,
      bottom: 90,
      right: 360,
      width: 350,
      height: 50,
      x: 10,
      y: 40,
      toJSON: () => ({}),
    });

    // Start drag
    act(() => {
      item.dispatchEvent(createTouchStartEvent(item, 100, 60));
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    // Drop without changing order — touchend listener is now on document
    act(() => {
      fireEvent.touchEnd(document);
    });

    expect(onReorder).not.toHaveBeenCalled();
  });
});
