import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SummarySheet } from '../SummarySheet';

vi.mock('@/services/albums', () => ({
  getAlbumSummary: vi.fn(),
  getAlbumCoverUrl: vi.fn((id: string) => `/api/albums/${id}/cover`),
}));

describe('SummarySheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows album name and artist', async () => {
    const { getAlbumSummary } = await import('@/services/albums');
    (getAlbumSummary as ReturnType<typeof vi.fn>).mockResolvedValue({
      summary: 'Great album!',
      summarySource: 'AI',
    });

    render(
      <SummarySheet
        open={true}
        onClose={vi.fn()}
        albumId="alb-1"
        albumName="Blackwater Park"
        artistName="Opeth"
      />
    );

    expect(screen.getByText('Blackwater Park')).toBeInTheDocument();
    expect(screen.getByText('Opeth')).toBeInTheDocument();
  });

  it('fetches and displays summary', async () => {
    const { getAlbumSummary } = await import('@/services/albums');
    (getAlbumSummary as ReturnType<typeof vi.fn>).mockResolvedValue({
      summary: 'A masterpiece of progressive death metal.',
      summarySource: 'AI',
    });

    render(
      <SummarySheet
        open={true}
        onClose={vi.fn()}
        albumId="alb-1"
        albumName="Blackwater Park"
        artistName="Opeth"
      />
    );

    await waitFor(() => {
      expect(
        screen.getByText('A masterpiece of progressive death metal.')
      ).toBeInTheDocument();
    });
  });

  it('shows loading state', async () => {
    const albumsModule = await import('@/services/albums');
    (albumsModule.getAlbumSummary as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise(() => {}) // never resolves
    );

    render(
      <SummarySheet
        open={true}
        onClose={vi.fn()}
        albumId="alb-1"
        albumName="Blackwater Park"
        artistName="Opeth"
      />
    );

    expect(screen.getByText('Loading summary...')).toBeInTheDocument();
  });

  it('shows error state on failure', async () => {
    const { getAlbumSummary } = await import('@/services/albums');
    (getAlbumSummary as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Network error')
    );

    render(
      <SummarySheet
        open={true}
        onClose={vi.fn()}
        albumId="alb-1"
        albumName="Blackwater Park"
        artistName="Opeth"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Failed to load summary')).toBeInTheDocument();
    });
  });

  it('does not fetch when closed', async () => {
    const albumsModule = await import('@/services/albums');
    (albumsModule.getAlbumSummary as ReturnType<typeof vi.fn>).mockClear();

    render(
      <SummarySheet
        open={false}
        onClose={vi.fn()}
        albumId="alb-1"
        albumName="Blackwater Park"
        artistName="Opeth"
      />
    );

    expect(albumsModule.getAlbumSummary).not.toHaveBeenCalled();
  });
});
