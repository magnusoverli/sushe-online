import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NowPlayingBar } from '../NowPlayingBar';
import { usePlaybackStore } from '@/stores/playback-store';

describe('NowPlayingBar', () => {
  beforeEach(() => {
    usePlaybackStore.getState().clearPlayback();
  });

  it('renders nothing when not visible', () => {
    const { container } = render(<NowPlayingBar visible={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders when visible', () => {
    usePlaybackStore.getState().setPlaybackState({
      trackName: 'Everything In Its Right Place',
      artistName: 'Radiohead',
    });

    render(<NowPlayingBar visible={true} />);

    expect(screen.getByTestId('now-playing-bar')).toBeInTheDocument();
    expect(screen.getByTestId('now-playing-track')).toHaveTextContent(
      'Everything In Its Right Place'
    );
    expect(screen.getByTestId('now-playing-artist')).toHaveTextContent(
      'Radiohead'
    );
  });

  it('shows default text when no track info', () => {
    render(<NowPlayingBar visible={true} />);

    expect(screen.getByTestId('now-playing-track')).toHaveTextContent(
      'Not Playing'
    );
  });

  it('shows device name when available', () => {
    usePlaybackStore.getState().setPlaybackState({
      trackName: 'Song',
      artistName: 'Artist',
      deviceName: 'MacBook Pro',
      deviceType: 'Computer',
    });

    render(<NowPlayingBar visible={true} />);

    expect(screen.getByTestId('now-playing-device')).toHaveTextContent(
      'MacBook Pro'
    );
  });

  it('renders progress bar with correct width', () => {
    usePlaybackStore.getState().setPlaybackState({
      trackName: 'Song',
      progressMs: 60000,
      durationMs: 240000,
    });

    render(<NowPlayingBar visible={true} />);

    const progress = screen.getByTestId('now-playing-progress');
    // 60000 / 240000 = 25%
    expect(progress.style.width).toBe('25%');
  });

  it('renders link to Spotify app', () => {
    usePlaybackStore.getState().setPlaybackState({
      trackName: 'Song',
      artistName: 'Artist',
    });

    render(<NowPlayingBar visible={true} />);

    const link = screen.getByTestId('now-playing-link');
    expect(link).toHaveAttribute('href', 'spotify:');
  });

  it('shows album art when available', () => {
    usePlaybackStore.getState().setPlaybackState({
      trackName: 'Song',
      albumArt: 'https://example.com/art.jpg',
    });

    render(<NowPlayingBar visible={true} />);

    const img = screen.getByAltText('Now playing');
    expect(img).toHaveAttribute('src', 'https://example.com/art.jpg');
  });
});
