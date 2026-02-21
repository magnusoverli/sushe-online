import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SortableAlbumList } from '../SortableAlbumList';

describe('SortableAlbumList', () => {
  const itemIds = ['a', 'b', 'c'];
  const onReorder = vi.fn();

  it('renders children when enabled', () => {
    render(
      <SortableAlbumList itemIds={itemIds} onReorder={onReorder} enabled={true}>
        {() => (
          <div data-testid="list">
            {itemIds.map((id) => (
              <div key={id} data-testid={`item-${id}`}>
                {id}
              </div>
            ))}
          </div>
        )}
      </SortableAlbumList>
    );

    expect(screen.getByTestId('list')).toBeInTheDocument();
    expect(screen.getByTestId('item-a')).toBeInTheDocument();
    expect(screen.getByTestId('item-b')).toBeInTheDocument();
    expect(screen.getByTestId('item-c')).toBeInTheDocument();
  });

  it('renders children when disabled (no DndContext wrapper)', () => {
    render(
      <SortableAlbumList
        itemIds={itemIds}
        onReorder={onReorder}
        enabled={false}
      >
        {() => (
          <div data-testid="list">
            {itemIds.map((id) => (
              <div key={id} data-testid={`item-${id}`}>
                {id}
              </div>
            ))}
          </div>
        )}
      </SortableAlbumList>
    );

    expect(screen.getByTestId('list')).toBeInTheDocument();
    expect(screen.getByTestId('item-a')).toBeInTheDocument();
  });

  it('passes null activeId to children when not dragging', () => {
    let capturedActiveId: string | null = 'should-be-null';

    render(
      <SortableAlbumList itemIds={itemIds} onReorder={onReorder} enabled={true}>
        {(activeId) => {
          capturedActiveId = activeId;
          return <div data-testid="list">content</div>;
        }}
      </SortableAlbumList>
    );

    expect(capturedActiveId).toBeNull();
  });
});
