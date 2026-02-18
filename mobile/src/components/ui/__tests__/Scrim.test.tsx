import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Scrim } from '../Scrim';

describe('Scrim', () => {
  it('renders when visible is true', () => {
    render(<Scrim visible={true} onDismiss={vi.fn()} />);
    expect(screen.getByTestId('scrim')).toBeInTheDocument();
  });

  it('does not render when visible is false', () => {
    render(<Scrim visible={false} onDismiss={vi.fn()} />);
    expect(screen.queryByTestId('scrim')).not.toBeInTheDocument();
  });

  it('calls onDismiss when clicked', () => {
    const onDismiss = vi.fn();
    render(<Scrim visible={true} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId('scrim'));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('calls onDismiss on Escape key', () => {
    const onDismiss = vi.fn();
    render(<Scrim visible={true} onDismiss={onDismiss} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('applies custom zIndex', () => {
    render(<Scrim visible={true} onDismiss={vi.fn()} zIndex={500} />);
    const el = screen.getByTestId('scrim');
    expect(el.style.zIndex).toBe('500');
  });

  it('is aria-hidden', () => {
    render(<Scrim visible={true} onDismiss={vi.fn()} />);
    expect(screen.getByTestId('scrim')).toHaveAttribute('aria-hidden', 'true');
  });
});
