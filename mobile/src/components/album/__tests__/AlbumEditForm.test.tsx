import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AlbumEditForm } from '../AlbumEditForm';
import type { Album } from '@/lib/types';

vi.mock('@/services/albums', () => ({
  getAlbumCoverUrl: vi.fn((id: string) => `/api/albums/${id}/cover`),
}));

vi.mock('@/services/tracks', () => ({
  fetchTracks: vi.fn(),
}));

vi.mock('@/services/track-picks', () => ({
  setTrackPick: vi.fn(),
  removeTrackPick: vi.fn(),
}));

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
  primary_track: 'Bleak',
  secondary_track: 'Harvest',
  comments: 'Great album',
  comments_2: 'Classic',
  tracks: [
    { title: 'Bleak', position: 1, length: 567000 },
    { title: 'Harvest', position: 2, length: 377000 },
  ],
  cover_image_format: 'JPEG',
  summary: 'A masterpiece',
  summary_source: 'AI',
  recommended_by: null,
  recommended_at: null,
};

describe('AlbumEditForm', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    album: mockAlbum,
    listId: 'list-1',
    onSave: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the form when open', () => {
    render(<AlbumEditForm {...defaultProps} />);
    expect(screen.getByTestId('album-edit-form')).toBeInTheDocument();
  });

  it('shows Edit Album title', () => {
    render(<AlbumEditForm {...defaultProps} />);
    expect(screen.getByText('Edit Album')).toBeInTheDocument();
  });

  it('populates artist field', () => {
    render(<AlbumEditForm {...defaultProps} />);
    const input = screen.getByTestId('edit-artist') as HTMLInputElement;
    expect(input.value).toBe('Opeth');
  });

  it('populates album field', () => {
    render(<AlbumEditForm {...defaultProps} />);
    const input = screen.getByTestId('edit-album') as HTMLInputElement;
    expect(input.value).toBe('Blackwater Park');
  });

  it('populates release date field', () => {
    render(<AlbumEditForm {...defaultProps} />);
    const input = screen.getByTestId('edit-release-date') as HTMLInputElement;
    expect(input.value).toBe('2001-03-12');
  });

  it('populates country select', () => {
    render(<AlbumEditForm {...defaultProps} />);
    const select = screen.getByTestId('edit-country') as HTMLSelectElement;
    expect(select.value).toBe('Sweden');
  });

  it('populates comments', () => {
    render(<AlbumEditForm {...defaultProps} />);
    const textarea = screen.getByTestId('edit-comments') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Great album');
  });

  it('shows Save button', () => {
    render(<AlbumEditForm {...defaultProps} />);
    expect(screen.getByTestId('edit-save')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();
  });

  it('shows Close button', () => {
    render(<AlbumEditForm {...defaultProps} />);
    expect(screen.getByTestId('edit-close')).toBeInTheDocument();
  });

  it('calls onSave with updated data', async () => {
    render(<AlbumEditForm {...defaultProps} />);

    // Change artist
    const artistInput = screen.getByTestId('edit-artist');
    fireEvent.change(artistInput, { target: { value: 'Opeth (Updated)' } });

    // Click save
    fireEvent.click(screen.getByTestId('edit-save'));

    await waitFor(() => {
      expect(defaultProps.onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          artist: 'Opeth (Updated)',
          album: 'Blackwater Park',
          country: 'Sweden',
        })
      );
    });
  });

  it('calls onClose on save success', async () => {
    render(<AlbumEditForm {...defaultProps} />);
    fireEvent.click(screen.getByTestId('edit-save'));

    await waitFor(() => {
      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  it('shows cover upload button', () => {
    render(<AlbumEditForm {...defaultProps} />);
    expect(screen.getByTestId('cover-upload-btn')).toBeInTheDocument();
  });

  it('shows track selector with existing tracks', () => {
    render(<AlbumEditForm {...defaultProps} />);
    expect(screen.getByText('Track Selection')).toBeInTheDocument();
    expect(screen.getByText('Bleak')).toBeInTheDocument();
    expect(screen.getByText('Harvest')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<AlbumEditForm {...defaultProps} open={false} />);
    expect(screen.queryByTestId('album-edit-form')).not.toBeInTheDocument();
  });

  it('cleans legacy genre_2 values', () => {
    const albumWithLegacy = { ...mockAlbum, genre_2: 'Genre 2' };
    render(<AlbumEditForm {...defaultProps} album={albumWithLegacy} />);
    // Genre 2 should be treated as empty (button shows placeholder)
    expect(screen.getByText('Select secondary genre')).toBeInTheDocument();
  });
});
