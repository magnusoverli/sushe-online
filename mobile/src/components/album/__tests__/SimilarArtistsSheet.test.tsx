import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SimilarArtistsSheet } from '../SimilarArtistsSheet';
import { clearImageCache } from '@/hooks/useArtistImage';

// Mock the lastfm service
vi.mock('@/services/lastfm', () => ({
  getSimilarArtists: vi.fn(),
}));

// Mock the useArtistImage hook so tests don't make real Deezer requests.
vi.mock('@/hooks/useArtistImage', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/hooks/useArtistImage')>();
  return {
    ...original,
    useArtistImage: vi.fn((name: string) => ({
      imageUrl: name
        ? `https://deezer.test/${encodeURIComponent(name)}.jpg`
        : null,
      isLoading: false,
    })),
  };
});

describe('SimilarArtistsSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearImageCache();
  });

  it('renders nothing when not open', () => {
    const { container } = render(
      <SimilarArtistsSheet
        open={false}
        onClose={() => {}}
        artistName="Radiohead"
      />
    );

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
    expect(screen.getByText('85% match')).toBeInTheDocument();
    expect(screen.getByText('72% match')).toBeInTheDocument();
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

  it('renders artist images from Last.fm when available', async () => {
    const { getSimilarArtists } = await import('@/services/lastfm');
    (getSimilarArtists as ReturnType<typeof vi.fn>).mockResolvedValue({
      artists: [
        {
          name: 'Portishead',
          match: '0.72',
          url: 'https://last.fm/portishead',
          image: 'https://lastfm.test/portishead.jpg',
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
      expect(screen.getByText('Portishead')).toBeInTheDocument();
    });

    const img = screen.getByTestId('artist-image') as HTMLImageElement;
    expect(img.src).toBe('https://lastfm.test/portishead.jpg');
  });

  it('falls back to Deezer image when Last.fm image is empty', async () => {
    const { getSimilarArtists } = await import('@/services/lastfm');
    (getSimilarArtists as ReturnType<typeof vi.fn>).mockResolvedValue({
      artists: [
        {
          name: 'Thom Yorke',
          match: '0.85',
          url: 'https://last.fm/thom-yorke',
          image: '',
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

    // The mocked useArtistImage returns a Deezer URL when given a non-empty name.
    const img = screen.getByTestId('artist-image') as HTMLImageElement;
    expect(img.src).toContain('deezer.test');
  });

  it('renders RYM link for each artist', async () => {
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
          name: 'Boards of Canada',
          match: '0.65',
          url: 'https://last.fm/boards-of-canada',
          image: '',
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

    const rymLinks = screen.getAllByTestId('rym-link') as HTMLAnchorElement[];
    expect(rymLinks).toHaveLength(2);
    expect(rymLinks[0]!.href).toBe(
      'https://rateyourmusic.com/artist/thom-yorke'
    );
    expect(rymLinks[1]!.href).toBe(
      'https://rateyourmusic.com/artist/boards-of-canada'
    );
  });
});
