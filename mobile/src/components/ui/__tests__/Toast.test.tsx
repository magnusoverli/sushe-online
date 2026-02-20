import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ToastContainer, useToastStore, showToast } from '../Toast';

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reset store
    useToastStore.setState({ message: null, type: 'info', duration: 3000 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not render when no message', () => {
    render(<ToastContainer />);
    expect(screen.queryByTestId('toast')).not.toBeInTheDocument();
  });

  it('renders when a message is shown', () => {
    render(<ToastContainer />);
    act(() => {
      showToast('Test message');
    });
    expect(screen.getByTestId('toast')).toBeInTheDocument();
    expect(screen.getByText('Test message')).toBeInTheDocument();
  });

  it('auto-clears after duration', () => {
    render(<ToastContainer />);
    act(() => {
      showToast('Temporary', 'info', 2000);
    });
    expect(screen.getByText('Temporary')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2100);
    });
    // Message should be cleared from store
    expect(useToastStore.getState().message).toBeNull();
  });

  it('showToast sets type correctly', () => {
    act(() => {
      showToast('Error!', 'error');
    });
    expect(useToastStore.getState().type).toBe('error');
    expect(useToastStore.getState().message).toBe('Error!');
  });

  it('showToast sets success type', () => {
    act(() => {
      showToast('Done', 'success');
    });
    expect(useToastStore.getState().type).toBe('success');
  });

  it('clears message via clear()', () => {
    act(() => {
      showToast('To clear');
    });
    expect(useToastStore.getState().message).toBe('To clear');

    act(() => {
      useToastStore.getState().clear();
    });
    expect(useToastStore.getState().message).toBeNull();
  });
});
