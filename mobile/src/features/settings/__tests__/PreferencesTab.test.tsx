import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PreferencesTab } from '../settings-tabs/PreferencesTab';
import type { PreferencesData } from '@/lib/types';

// ── Mocks ──

const mockPreferencesData: PreferencesData = {
  topGenres: [
    { name: 'Jazz', count: 12, points: 36 },
    { name: 'Rock', count: 10, points: 30 },
  ],
  topArtists: [
    { name: 'Miles Davis', count: 5, points: 15 },
    { name: 'Radiohead', count: 4, points: 12 },
  ],
  topCountries: [
    { name: 'United States', count: 20, points: 60 },
    { name: 'United Kingdom', count: 15, points: 45 },
  ],
  totalAlbums: 42,
  spotify: {
    topArtists: {
      short_term: [{ name: 'Tame Impala', genres: ['psych rock'] }],
      medium_term: [],
      long_term: [],
    },
    topTracks: {
      short_term: [{ name: 'Let It Happen', artist: 'Tame Impala' }],
      medium_term: [],
      long_term: [],
    },
    syncedAt: '2025-01-01T00:00:00Z',
  },
  lastfm: {
    topArtists: {
      overall: [{ name: 'Radiohead', playcount: 500 }],
      '7day': [],
      '1month': [],
      '3month': [],
      '6month': [],
      '12month': [],
    },
    totalScrobbles: 12345,
    syncedAt: '2025-01-01T00:00:00Z',
  },
  affinity: {
    genres: [{ name: 'Jazz', score: 0.85, sources: ['lists', 'spotify'] }],
    artists: [
      { name: 'Miles Davis', score: 0.92, sources: ['lists', 'lastfm'] },
    ],
  },
  updatedAt: '2025-01-15T12:00:00Z',
};

let mockQueryReturn: {
  data: PreferencesData | null | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: ReturnType<typeof vi.fn>;
};

const mockMutate = vi.fn();

vi.mock('@/hooks/usePreferences', () => ({
  usePreferences: () => mockQueryReturn,
  useSyncPreferences: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
}));

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={createQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

describe('PreferencesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryReturn = {
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    };
  });

  it('should render loading state', () => {
    mockQueryReturn = {
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    };

    render(
      <Wrapper>
        <PreferencesTab />
      </Wrapper>
    );

    expect(screen.getByTestId('preferences-loading')).toBeInTheDocument();
    expect(screen.getByText('Loading preferences...')).toBeInTheDocument();
  });

  it('should render no-data state with sync button', () => {
    mockQueryReturn = {
      data: null,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    };

    render(
      <Wrapper>
        <PreferencesTab />
      </Wrapper>
    );

    expect(screen.getByTestId('preferences-empty')).toBeInTheDocument();
    expect(
      screen.getByText('No preferences data. Tap Sync Now to generate.')
    ).toBeInTheDocument();
    expect(screen.getByTestId('preferences-sync')).toBeInTheDocument();
  });

  it('should render data sections when data is available', () => {
    mockQueryReturn = {
      data: mockPreferencesData,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    };

    render(
      <Wrapper>
        <PreferencesTab />
      </Wrapper>
    );

    expect(screen.getByTestId('preferences-content')).toBeInTheDocument();

    // Quick Stats
    expect(screen.getByText('Quick Stats')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument(); // totalAlbums

    // Top Genres
    expect(screen.getByText('Top Genres')).toBeInTheDocument();
    // Jazz appears in both Top Genres and Genre Affinity
    expect(screen.getAllByText('Jazz').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Rock')).toBeInTheDocument();

    // Top Artists
    expect(screen.getByText('Top Artists')).toBeInTheDocument();
    // Miles Davis appears in both Top Artists and Artist Affinity
    expect(screen.getAllByText('Miles Davis').length).toBeGreaterThanOrEqual(1);

    // Top Countries
    expect(screen.getByText('Top Countries')).toBeInTheDocument();
    expect(screen.getByText('United States')).toBeInTheDocument();

    // Affinity sections
    expect(screen.getByText('Genre Affinity')).toBeInTheDocument();
    expect(screen.getByText('85%')).toBeInTheDocument();
    expect(screen.getByText('Artist Affinity')).toBeInTheDocument();
    expect(screen.getByText('92%')).toBeInTheDocument();

    // Spotify section
    expect(
      screen.getByText('Spotify Top Artists & Tracks')
    ).toBeInTheDocument();
    expect(screen.getByText('Tame Impala')).toBeInTheDocument();

    // Last.fm section
    expect(screen.getByText('Last.fm Top Artists')).toBeInTheDocument();
    expect(screen.getByText('Last.fm Stats')).toBeInTheDocument();
    expect(screen.getByText('12,345')).toBeInTheDocument();

    // Sync button
    expect(screen.getByText('Sync Now')).toBeInTheDocument();
  });

  it('should trigger sync mutation when Sync Now is clicked', async () => {
    mockQueryReturn = {
      data: null,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    };

    render(
      <Wrapper>
        <PreferencesTab />
      </Wrapper>
    );

    fireEvent.click(screen.getByTestId('preferences-sync'));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledTimes(1);
    });
  });

  it('should hide Spotify section when spotify is null', () => {
    mockQueryReturn = {
      data: { ...mockPreferencesData, spotify: null },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    };

    render(
      <Wrapper>
        <PreferencesTab />
      </Wrapper>
    );

    expect(
      screen.queryByText('Spotify Top Artists & Tracks')
    ).not.toBeInTheDocument();
  });

  it('should hide Last.fm section when lastfm is null', () => {
    mockQueryReturn = {
      data: { ...mockPreferencesData, lastfm: null },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    };

    render(
      <Wrapper>
        <PreferencesTab />
      </Wrapper>
    );

    expect(screen.queryByText('Last.fm Top Artists')).not.toBeInTheDocument();
    expect(screen.queryByText('Last.fm Stats')).not.toBeInTheDocument();
  });
});
