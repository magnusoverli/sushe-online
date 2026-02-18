import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ServiceChooserSheet } from '../ServiceChooserSheet';

describe('ServiceChooserSheet', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    onSelect: vi.fn(),
  };

  it('renders title "Play with..."', () => {
    render(<ServiceChooserSheet {...defaultProps} />);
    expect(screen.getByText('Play with...')).toBeInTheDocument();
  });

  it('shows Spotify option', () => {
    render(<ServiceChooserSheet {...defaultProps} />);
    expect(screen.getByText('Spotify')).toBeInTheDocument();
    expect(screen.getByText('Choose a device to play on')).toBeInTheDocument();
  });

  it('shows Tidal option', () => {
    render(<ServiceChooserSheet {...defaultProps} />);
    expect(screen.getByText('Tidal')).toBeInTheDocument();
    expect(
      screen.getByText('Open in Tidal app or browser')
    ).toBeInTheDocument();
  });

  it('calls onSelect with "spotify" when Spotify is clicked', () => {
    const onSelect = vi.fn();
    render(<ServiceChooserSheet {...defaultProps} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('service-choice-spotify'));
    expect(onSelect).toHaveBeenCalledWith('spotify');
  });

  it('calls onSelect with "tidal" when Tidal is clicked', () => {
    const onSelect = vi.fn();
    render(<ServiceChooserSheet {...defaultProps} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('service-choice-tidal'));
    expect(onSelect).toHaveBeenCalledWith('tidal');
  });
});
