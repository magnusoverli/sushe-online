import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GhostCard } from '../GhostCard';

describe('GhostCard', () => {
  it('renders when visible is true', () => {
    render(
      <GhostCard visible={true} x={100} y={200} width={350}>
        <div>Ghost content</div>
      </GhostCard>
    );
    expect(screen.getByTestId('ghost-card')).toBeInTheDocument();
    expect(screen.getByText('Ghost content')).toBeInTheDocument();
  });

  it('does not render when visible is false', () => {
    render(
      <GhostCard visible={false} x={100} y={200} width={350}>
        <div>Ghost content</div>
      </GhostCard>
    );
    expect(screen.queryByTestId('ghost-card')).not.toBeInTheDocument();
  });

  it('positions at given x/y coordinates', () => {
    render(
      <GhostCard visible={true} x={150} y={300} width={340}>
        <div>content</div>
      </GhostCard>
    );
    const ghost = screen.getByTestId('ghost-card');
    expect(ghost.style.left).toBe('150px');
    expect(ghost.style.top).toBe('300px');
  });

  it('applies the given width', () => {
    render(
      <GhostCard visible={true} x={0} y={0} width={320}>
        <div>content</div>
      </GhostCard>
    );
    const ghost = screen.getByTestId('ghost-card');
    expect(ghost.style.width).toBe('320px');
  });

  it('has pointer-events none', () => {
    render(
      <GhostCard visible={true} x={0} y={0} width={320}>
        <div>content</div>
      </GhostCard>
    );
    const ghost = screen.getByTestId('ghost-card');
    expect(ghost.style.pointerEvents).toBe('none');
  });
});
