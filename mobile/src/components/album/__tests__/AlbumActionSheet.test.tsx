import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AlbumActionSheet } from '../AlbumActionSheet';
import type { Album, User } from '@/lib/types';

// Mock spotify service
vi.mock('@/services/spotify', () => ({
  getDevices: vi.fn(() =>
    Promise.resolve({
      devices: [
        { id: 'd1', name: 'Speaker', type: 'Speaker', is_active: true },
      ],
    })
  ),
  searchAlbum: vi.fn(() => Promise.resolve({ id: 'sp-id' })),
  playAlbum: vi.fn(() => Promise.resolve({ success: true })),
}));

// Mock tidal service
vi.mock('@/services/tidal', () => ({
  openInTidal: vi.fn(),
}));

// Mock playback features
vi.mock('@/features/playback', () => ({
  getDeviceIcon: vi.fn(() => '🔊'),
}));

// Mock toast
vi.mock('@/components/ui/Toast', () => ({
  showToast: vi.fn(),
}));

import { openInTidal } from '@/services/tidal';

const mockAlbum: Album = {
  _id: 'item-1',
  artist: 'Opeth',
  album: 'Blackwater Park',
  album_id: 'alb-1',
  release_date: '2001-03-12',
  country: 'Sweden',
  genre_1: 'Progressive Metal',
  genre_2: 'Death Metal',
  track_pick: '',
  primary_track: null,
  secondary_track: null,
  comments: '',
  comments_2: '',
  tracks: null,
  cover_image_format: '',
  summary: '',
  summary_source: '',
  recommended_by: null,
  recommended_at: null,
};

const mockUser: User = {
  _id: 'u1',
  email: 'test@test.com',
  username: 'test',
  role: 'user',
  spotifyConnected: false,
  tidalConnected: false,
  lastfmConnected: false,
};

describe('AlbumActionSheet', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    album: mockAlbum,
    listYear: 2001,
    user: mockUser,
    onEditDetails: vi.fn(),
    onMoveToList: vi.fn(),
    onCopyToList: vi.fn(),
    onRemove: vi.fn(),
  };

  it('renders album name in subtitle', () => {
    render(<AlbumActionSheet {...defaultProps} />);
    expect(screen.getByText(/Opeth/)).toBeInTheDocument();
  });

  it('shows Edit Details action', () => {
    render(<AlbumActionSheet {...defaultProps} />);
    expect(screen.getByText('Edit Details')).toBeInTheDocument();
  });

  it('shows Move to List and Copy to List', () => {
    render(<AlbumActionSheet {...defaultProps} />);
    expect(screen.getByText('Move to List...')).toBeInTheDocument();
    expect(screen.getByText('Copy to List...')).toBeInTheDocument();
  });

  it('shows Remove from List (destructive)', () => {
    render(<AlbumActionSheet {...defaultProps} />);
    expect(screen.getByText('Remove from List')).toBeInTheDocument();
  });

  it('shows Recommend when list has year', () => {
    render(<AlbumActionSheet {...defaultProps} listYear={2001} />);
    expect(screen.getByText('Recommend')).toBeInTheDocument();
  });

  it('hides Recommend when list has no year', () => {
    render(<AlbumActionSheet {...defaultProps} listYear={null} />);
    expect(screen.queryByText('Recommend')).not.toBeInTheDocument();
  });

  it('shows Similar Artists when Last.fm connected', () => {
    const user = { ...mockUser, lastfmConnected: true };
    render(<AlbumActionSheet {...defaultProps} user={user} />);
    expect(screen.getByText('Similar Artists')).toBeInTheDocument();
  });

  it('hides Similar Artists when Last.fm not connected', () => {
    render(<AlbumActionSheet {...defaultProps} />);
    expect(screen.queryByText('Similar Artists')).not.toBeInTheDocument();
  });

  it('renders nothing when album is null', () => {
    const { container } = render(
      <AlbumActionSheet {...defaultProps} album={null} />
    );
    expect(
      container.querySelector('[data-testid="bottom-sheet"]')
    ).not.toBeInTheDocument();
  });

  it('calls onClose then action handler when Edit Details is clicked', () => {
    vi.useFakeTimers();
    render(<AlbumActionSheet {...defaultProps} />);
    fireEvent.click(screen.getByText('Edit Details'));
    expect(defaultProps.onClose).toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(defaultProps.onEditDetails).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('shows disabled Play Album when no service connected', () => {
    render(<AlbumActionSheet {...defaultProps} />);
    expect(screen.getByText('Play Album')).toBeInTheDocument();
    // The disabled ActionItem version is rendered
    const playButton = screen.getByText('Play Album').closest('button');
    expect(playButton).toBeDisabled();
  });

  it('shows Play Album button when only Spotify is connected', () => {
    const user = { ...mockUser, spotifyConnected: true };
    render(<AlbumActionSheet {...defaultProps} user={user} />);
    expect(screen.getByTestId('play-album-action')).toBeInTheDocument();
  });

  it('shows "Open in Tidal" when only Tidal is connected', () => {
    const user = { ...mockUser, tidalConnected: true };
    render(<AlbumActionSheet {...defaultProps} user={user} />);
    expect(screen.getByText('Open in Tidal')).toBeInTheDocument();
  });

  it('opens Tidal when clicking play with only Tidal connected', () => {
    const user = { ...mockUser, tidalConnected: true };
    const onClose = vi.fn();
    render(
      <AlbumActionSheet {...defaultProps} user={user} onClose={onClose} />
    );
    fireEvent.click(screen.getByTestId('play-album-action'));
    expect(openInTidal).toHaveBeenCalledWith('Opeth', 'Blackwater Park');
  });

  it('shows service chooser when both connected with no preference', async () => {
    const user = {
      ...mockUser,
      spotifyConnected: true,
      tidalConnected: true,
      musicService: null,
    };
    render(<AlbumActionSheet {...defaultProps} user={user} />);
    fireEvent.click(screen.getByTestId('play-album-action'));
    await waitFor(() => {
      expect(screen.getByText('Play with...')).toBeInTheDocument();
    });
  });

  it('expands Spotify devices when both connected with spotify preference', async () => {
    const user = {
      ...mockUser,
      spotifyConnected: true,
      tidalConnected: true,
      musicService: 'spotify',
    };
    render(<AlbumActionSheet {...defaultProps} user={user} />);
    fireEvent.click(screen.getByTestId('play-album-action'));
    await waitFor(() => {
      expect(screen.getByTestId('device-picker')).toBeInTheDocument();
    });
  });

  it('opens Tidal when both connected with tidal preference', () => {
    const user = {
      ...mockUser,
      spotifyConnected: true,
      tidalConnected: true,
      musicService: 'tidal',
    };
    render(<AlbumActionSheet {...defaultProps} user={user} />);
    fireEvent.click(screen.getByTestId('play-album-action'));
    expect(openInTidal).toHaveBeenCalledWith('Opeth', 'Blackwater Park');
  });

  it('shows "Open in Tidal" link when Spotify devices are expanded and Tidal is connected', async () => {
    const user = {
      ...mockUser,
      spotifyConnected: true,
      tidalConnected: true,
      musicService: 'spotify',
    };
    render(<AlbumActionSheet {...defaultProps} user={user} />);
    fireEvent.click(screen.getByTestId('play-album-action'));
    await waitFor(() => {
      expect(screen.getByTestId('open-in-tidal')).toBeInTheDocument();
    });
  });
});
