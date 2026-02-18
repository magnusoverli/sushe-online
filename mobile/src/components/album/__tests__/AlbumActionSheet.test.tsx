import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AlbumActionSheet } from '../AlbumActionSheet';
import type { Album, User } from '@/lib/types';

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
});
