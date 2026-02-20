import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from '../ConfirmDialog';

describe('ConfirmDialog', () => {
  const defaultProps = {
    open: true,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    title: 'Delete Item',
    message: 'Are you sure?',
  };

  it('renders when open', () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
    expect(screen.getByText('Delete Item')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<ConfirmDialog {...defaultProps} open={false} />);
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
  });

  it('shows warning text', () => {
    render(<ConfirmDialog {...defaultProps} warning="Cannot undo!" />);
    expect(screen.getByTestId('confirm-warning')).toHaveTextContent(
      'Cannot undo!'
    );
  });

  it('calls onConfirm when confirm button clicked', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByTestId('confirm-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when cancel button clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId('confirm-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows custom button labels', () => {
    render(
      <ConfirmDialog
        {...defaultProps}
        confirmLabel="Delete"
        cancelLabel="Keep"
      />
    );
    expect(screen.getByTestId('confirm-confirm')).toHaveTextContent('Delete');
    expect(screen.getByTestId('confirm-cancel')).toHaveTextContent('Keep');
  });

  it('disables confirm button when confirmDisabled is true', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog {...defaultProps} onConfirm={onConfirm} confirmDisabled />
    );
    const btn = screen.getByTestId('confirm-confirm');
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('renders children (e.g. checkbox)', () => {
    render(
      <ConfirmDialog {...defaultProps}>
        <input type="checkbox" data-testid="extra-checkbox" />
      </ConfirmDialog>
    );
    expect(screen.getByTestId('extra-checkbox')).toBeInTheDocument();
  });
});
