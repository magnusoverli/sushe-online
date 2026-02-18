import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SimilarArtistsSheet } from '../SimilarArtistsSheet';

// Mock the lastfm service
vi.mock('@/services/lastfm', () => ({
  getSimilarArtists: vi.fn(),
}));

describe('SimilarArtistsSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when not open', () => {
    const { container } = render(
      <SimilarArtistsSheet
        open={false}
        onClose={() => {}}
        artistName="Radiohead"
      />
    );

    // BottomSheet is not rendered when closed (or rendered hidden)
    expect(
      container.querySelector('[data-testid="similar-artist-item"]')
    ).toBeNull();
  });

  it('shows loading state', async () => {
    const { getSimilarArtists } = await import('@/services/lastfm');
    (getSimilarArtists as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    render(
      <SimilarArtistsSheet
        open={true}
        onClose={() => {}}
        artistName="Radiohead"
      />
    );

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows artists after loading', async () => {
    const { getSimilarArtists } = await import('@/services/lastfm');
    (getSimilarArtists as ReturnType<typeof vi.fn>).mockResolvedValue({
      artists: [
        {
          name: 'Thom Yorke',
          match: '0.85',
          url: 'https://last.fm/thom-yorke',
          image: '',
        },
        {
          name: 'Portishead',
          match: '0.72',
          url: 'https://last.fm/portishead',
          image: 'https://example.com/portishead.jpg',
        },
      ],
    });

    render(
      <SimilarArtistsSheet
        open={true}
        onClose={() => {}}
        artistName="Radiohead"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Thom Yorke')).toBeInTheDocument();
    });

    expect(screen.getByText('Portishead')).toBeInTheDocument();
    expect(screen.getByText('85%')).toBeInTheDocument();
    expect(screen.getByText('72%')).toBeInTheDocument();
  });

  it('shows error message on failure', async () => {
    const { getSimilarArtists } = await import('@/services/lastfm');
    (getSimilarArtists as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Network error')
    );

    render(
      <SimilarArtistsSheet
        open={true}
        onClose={() => {}}
        artistName="Radiohead"
      />
    );

    await waitFor(() => {
      expect(
        screen.getByText('Failed to load similar artists')
      ).toBeInTheDocument();
    });
  });

  it('shows empty state when no artists found', async () => {
    const { getSimilarArtists } = await import('@/services/lastfm');
    (getSimilarArtists as ReturnType<typeof vi.fn>).mockResolvedValue({
      artists: [],
    });

    render(
      <SimilarArtistsSheet
        open={true}
        onClose={() => {}}
        artistName="Unknown Artist"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('No similar artists found.')).toBeInTheDocument();
    });
  });
});
