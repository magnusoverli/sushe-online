import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BottomSheet } from '../BottomSheet';

describe('BottomSheet', () => {
  it('renders when open is true', () => {
    render(
      <BottomSheet open={true} onClose={vi.fn()}>
        <div>Sheet content</div>
      </BottomSheet>
    );
    expect(screen.getByTestId('bottom-sheet')).toBeInTheDocument();
    expect(screen.getByText('Sheet content')).toBeInTheDocument();
  });

  it('does not render when open is false', () => {
    render(
      <BottomSheet open={false} onClose={vi.fn()}>
        <div>Sheet content</div>
      </BottomSheet>
    );
    expect(screen.queryByTestId('bottom-sheet')).not.toBeInTheDocument();
  });

  it('renders title when provided', () => {
    render(
      <BottomSheet open={true} onClose={vi.fn()} title="List Options">
        <div>content</div>
      </BottomSheet>
    );
    expect(screen.getByText('List Options')).toBeInTheDocument();
  });

  it('renders drag handle', () => {
    render(
      <BottomSheet open={true} onClose={vi.fn()}>
        <div>content</div>
      </BottomSheet>
    );
    expect(screen.getByTestId('sheet-handle')).toBeInTheDocument();
  });

  it('renders scrim when open', () => {
    render(
      <BottomSheet open={true} onClose={vi.fn()}>
        <div>content</div>
      </BottomSheet>
    );
    expect(screen.getByTestId('scrim')).toBeInTheDocument();
  });

  it('has dialog role and aria-modal', () => {
    render(
      <BottomSheet open={true} onClose={vi.fn()}>
        <div>content</div>
      </BottomSheet>
    );
    const sheet = screen.getByTestId('bottom-sheet');
    expect(sheet).toHaveAttribute('role', 'dialog');
    expect(sheet).toHaveAttribute('aria-modal', 'true');
  });
});
