import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SortableAlbumCard } from '../SortableAlbumCard';

describe('SortableAlbumCard', () => {
  it('renders overlay variant with ghost styling', () => {
    render(
      <SortableAlbumCard id="test-1" isOverlay activeId="test-1">
        <div data-testid="card-content">Album Content</div>
      </SortableAlbumCard>
    );

    expect(screen.getByTestId('card-content')).toBeInTheDocument();

    // Overlay wrapper should have ghost styling
    const wrapper = screen.getByTestId('card-content').parentElement!;
    expect(wrapper.style.pointerEvents).toBe('none');
    expect(wrapper.style.borderRadius).toBe('var(--radius-card)');
  });

  it('renders content for overlay cards', () => {
    render(
      <SortableAlbumCard id="test-1" isOverlay activeId="test-1">
        <div data-testid="inner">Inner</div>
      </SortableAlbumCard>
    );

    expect(screen.getByTestId('inner')).toBeInTheDocument();
    expect(screen.getByTestId('inner')).toHaveTextContent('Inner');
  });
});
