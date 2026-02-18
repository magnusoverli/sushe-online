import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TrackSelector } from '../TrackSelector';
import type { Track } from '@/lib/types';

// Mock the services
vi.mock('@/services/tracks', () => ({
  fetchTracks: vi.fn(),
}));

vi.mock('@/services/track-picks', () => ({
  setTrackPick: vi.fn(),
  removeTrackPick: vi.fn(),
}));

const mockTracks: Track[] = [
  { title: 'The Leper Affinity', position: 1, length: 620000 },
  { title: 'Bleak', position: 2, length: 567000 },
  { title: 'Harvest', position: 3, length: 377000 },
  { title: 'The Drapery Falls', position: 4, length: 632000 },
];

describe('TrackSelector', () => {
  const defaultProps = {
    listItemId: 'item-1',
    artist: 'Opeth',
    albumName: 'Blackwater Park',
    tracks: mockTracks,
    primaryTrack: null as string | null,
    secondaryTrack: null as string | null,
    onTrackPickChanged: vi.fn(),
    onTracksLoaded: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders track list when tracks are provided', () => {
    render(<TrackSelector {...defaultProps} />);
    expect(screen.getByText('The Leper Affinity')).toBeInTheDocument();
    expect(screen.getByText('Bleak')).toBeInTheDocument();
    expect(screen.getByText('Harvest')).toBeInTheDocument();
  });

  it('shows header and instructions', () => {
    render(<TrackSelector {...defaultProps} />);
    expect(screen.getByText('Track Selection')).toBeInTheDocument();
  });

  it('shows "Get Tracks" button when no tracks', () => {
    render(<TrackSelector {...defaultProps} tracks={null} />);
    expect(screen.getByTestId('fetch-tracks-btn')).toBeInTheDocument();
    expect(screen.getByText('Get Tracks')).toBeInTheDocument();
  });

  it('shows primary track indicator', () => {
    render(<TrackSelector {...defaultProps} primaryTrack="Bleak" />);
    const bleak = screen.getByTestId('track-2');
    expect(bleak).toHaveTextContent('★');
  });

  it('shows secondary track indicator', () => {
    render(<TrackSelector {...defaultProps} secondaryTrack="Harvest" />);
    const harvest = screen.getByTestId('track-3');
    expect(harvest).toHaveTextContent('☆');
  });

  it('shows track duration', () => {
    render(<TrackSelector {...defaultProps} />);
    // 620000ms = 10:20
    expect(screen.getByText('10:20')).toBeInTheDocument();
  });

  it('calls setTrackPick on unselected track click', async () => {
    const { setTrackPick } = await import('@/services/track-picks');
    (setTrackPick as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      listItemId: 'item-1',
      primary_track: '',
      secondary_track: 'The Leper Affinity',
    });

    render(<TrackSelector {...defaultProps} />);
    fireEvent.click(screen.getByTestId('track-1'));

    await waitFor(() => {
      expect(setTrackPick).toHaveBeenCalledWith(
        'item-1',
        'The Leper Affinity',
        2
      );
    });
  });

  it('shows existing picks when no track list is loaded', () => {
    render(
      <TrackSelector
        {...defaultProps}
        tracks={null}
        primaryTrack="Bleak"
        secondaryTrack="Harvest"
      />
    );
    expect(screen.getByText(/Bleak/)).toBeInTheDocument();
    expect(screen.getByText(/Harvest/)).toBeInTheDocument();
  });

  it('fetches tracks when Get Tracks is clicked', async () => {
    const { fetchTracks } = await import('@/services/tracks');
    (fetchTracks as ReturnType<typeof vi.fn>).mockResolvedValue({
      tracks: mockTracks,
      releaseId: 'rel-1',
    });

    render(<TrackSelector {...defaultProps} tracks={null} />);
    fireEvent.click(screen.getByText('Get Tracks'));

    await waitFor(() => {
      expect(fetchTracks).toHaveBeenCalledWith('Opeth', 'Blackwater Park');
    });
  });
});
