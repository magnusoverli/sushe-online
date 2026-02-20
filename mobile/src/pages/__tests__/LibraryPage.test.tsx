import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LibraryPage } from '../LibraryPage';
import type { ListMetadata, Album, Group } from '@/lib/types';

// ── Mocks ──

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

const mockListsMetadata: Record<string, ListMetadata> = {
  list1: {
    _id: 'list1',
    name: 'Best of 2024',
    year: 2024,
    isMain: true,
    count: 2,
    groupId: 'group1',
    sortOrder: 0,
    updatedAt: '2024-01-01',
    createdAt: '2024-01-01',
  },
};

const mockAlbums: Album[] = [
  {
    _id: 'item1',
    artist: 'Radiohead',
    album: 'OK Computer',
    album_id: 'album1',
    release_date: '1997-06-16',
    country: 'United Kingdom',
    genre_1: 'Alternative Rock',
    genre_2: '',
    track_pick: '',
    primary_track: null,
    secondary_track: null,
    comments: '',
    comments_2: '',
    tracks: null,
    cover_image_url: '/api/albums/album1/cover',
    cover_image_format: 'JPEG',
    summary: '',
    summary_source: '',
    recommended_by: null,
    recommended_at: null,
  },
  {
    _id: 'item2',
    artist: 'Björk',
    album: 'Homogenic',
    album_id: 'album2',
    release_date: '2024-09-22',
    country: 'Iceland',
    genre_1: 'Electronic',
    genre_2: 'Art Pop',
    track_pick: '',
    primary_track: null,
    secondary_track: null,
    comments: '',
    comments_2: '',
    tracks: null,
    cover_image_url: '/api/albums/album2/cover',
    cover_image_format: 'JPEG',
    summary: 'An AI summary',
    summary_source: 'openai',
    recommended_by: 'friendUser',
    recommended_at: '2024-06-01',
  },
];

const mockGroups: Group[] = [
  {
    _id: 'group1',
    name: '2024',
    sortOrder: 0,
    year: 2024,
    isYearGroup: true,
    listCount: 1,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  },
];

const mockGetLists = vi.fn();
const mockGetList = vi.fn();
const mockGetGroups = vi.fn();
const mockGetSetupStatus = vi.fn();

vi.mock('@/services/lists', () => ({
  getLists: () => mockGetLists(),
  getList: (id: string) => mockGetList(id),
  getSetupStatus: () => mockGetSetupStatus(),
}));

vi.mock('@/services/groups', () => ({
  getGroups: () => mockGetGroups(),
}));

vi.mock('@/services/albums', () => ({
  getAlbumCoverUrl: (id: string) => `/api/albums/${id}/cover`,
}));

// Mock year-lock service
const mockCheckYearLock = vi.fn();
const mockGetLockedYears = vi.fn();

vi.mock('@/services/year-lock', () => ({
  checkYearLock: (...args: unknown[]) => mockCheckYearLock(...args),
  getLockedYears: () => mockGetLockedYears(),
}));

// Mock IntersectionObserver for CoverImage
beforeEach(() => {
  vi.clearAllMocks();
  // @ts-expect-error - mocking IntersectionObserver
  globalThis.IntersectionObserver = vi.fn(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));
  // Default: no years locked
  mockCheckYearLock.mockResolvedValue(false);
  mockGetLockedYears.mockResolvedValue(new Set());
  // Default: no setup needed
  mockGetSetupStatus.mockResolvedValue({
    needsSetup: false,
    listsWithoutYear: [],
    yearsNeedingMain: [],
    yearsSummary: [],
    dismissedUntil: null,
  });
});

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <LibraryPage />
    </QueryClientProvider>
  );
}

describe('LibraryPage', () => {
  it('shows loading state initially', () => {
    mockGetLists.mockReturnValue(new Promise(() => {})); // never resolves
    mockGetGroups.mockResolvedValue([]);
    renderWithProviders();

    expect(screen.getByText('Loading lists...')).toBeInTheDocument();
  });

  it('shows error state on lists fetch failure', async () => {
    mockGetLists.mockRejectedValue(new Error('Network error'));
    mockGetGroups.mockResolvedValue([]);
    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByText('Failed to load lists.')).toBeInTheDocument();
    });
  });

  it('shows empty state when no lists', async () => {
    mockGetLists.mockResolvedValue({});
    mockGetGroups.mockResolvedValue([]);
    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByText('No Lists Yet')).toBeInTheDocument();
    });
  });

  it('renders list header with name and metadata', async () => {
    mockGetLists.mockResolvedValue(mockListsMetadata);
    mockGetList.mockResolvedValue(mockAlbums);
    mockGetGroups.mockResolvedValue(mockGroups);
    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByTestId('list-header-title')).toHaveTextContent(
        'Best of 2024'
      );
    });
  });

  it('renders album cards for the active list', async () => {
    mockGetLists.mockResolvedValue(mockListsMetadata);
    mockGetList.mockResolvedValue(mockAlbums);
    mockGetGroups.mockResolvedValue(mockGroups);
    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByTestId('album-list')).toBeInTheDocument();
    });

    const cards = screen.getAllByTestId('album-card');
    expect(cards).toHaveLength(2);

    expect(screen.getByText('OK Computer')).toBeInTheDocument();
    expect(screen.getByText('Radiohead')).toBeInTheDocument();
    expect(screen.getByText('Homogenic')).toBeInTheDocument();
    expect(screen.getByText('Björk')).toBeInTheDocument();
  });

  it('shows genre tags on album cards', async () => {
    mockGetLists.mockResolvedValue(mockListsMetadata);
    mockGetList.mockResolvedValue(mockAlbums);
    mockGetGroups.mockResolvedValue(mockGroups);
    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByText('Alternative Rock')).toBeInTheDocument();
    });
    expect(screen.getByText('Electronic')).toBeInTheDocument();
    expect(screen.getByText('Art Pop')).toBeInTheDocument();
  });

  it('shows year mismatch tag for mismatched albums', async () => {
    mockGetLists.mockResolvedValue(mockListsMetadata);
    mockGetList.mockResolvedValue(mockAlbums);
    mockGetGroups.mockResolvedValue(mockGroups);
    renderWithProviders();

    // Radiohead's OK Computer is from 1997 but list year is 2024
    await waitFor(() => {
      expect(screen.getByText('1997')).toBeInTheDocument();
    });
  });

  it('renders list footer with album count', async () => {
    mockGetLists.mockResolvedValue(mockListsMetadata);
    mockGetList.mockResolvedValue(mockAlbums);
    mockGetGroups.mockResolvedValue(mockGroups);
    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByTestId('list-footer')).toBeInTheDocument();
    });
    expect(screen.getByTestId('list-footer')).toHaveTextContent('2 albums');
  });

  it('auto-selects the main list', async () => {
    mockGetLists.mockResolvedValue(mockListsMetadata);
    mockGetList.mockResolvedValue(mockAlbums);
    mockGetGroups.mockResolvedValue(mockGroups);
    renderWithProviders();

    await waitFor(() => {
      // Should have called getList with 'list1' (the main list)
      expect(mockGetList).toHaveBeenCalledWith('list1');
    });
  });

  it('shows sort trigger button', async () => {
    mockGetLists.mockResolvedValue(mockListsMetadata);
    mockGetList.mockResolvedValue(mockAlbums);
    mockGetGroups.mockResolvedValue(mockGroups);
    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByTestId('sort-trigger')).toBeInTheDocument();
    });
  });

  it('shows albums loading state', async () => {
    mockGetLists.mockResolvedValue(mockListsMetadata);
    mockGetList.mockReturnValue(new Promise(() => {})); // never resolves
    mockGetGroups.mockResolvedValue(mockGroups);
    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByTestId('skeleton-list')).toBeInTheDocument();
    });
  });

  it('shows empty list state', async () => {
    mockGetLists.mockResolvedValue(mockListsMetadata);
    mockGetList.mockResolvedValue([]);
    mockGetGroups.mockResolvedValue(mockGroups);
    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByText('This list is empty.')).toBeInTheDocument();
    });
  });

  describe('year lock', () => {
    it('shows lock indicator in header when main list year is locked', async () => {
      mockCheckYearLock.mockResolvedValue(true);
      mockGetLockedYears.mockResolvedValue(new Set([2024]));
      mockGetLists.mockResolvedValue(mockListsMetadata);
      mockGetList.mockResolvedValue(mockAlbums);
      mockGetGroups.mockResolvedValue(mockGroups);
      renderWithProviders();

      await waitFor(() => {
        expect(screen.getByTestId('list-header-lock')).toBeInTheDocument();
      });
      expect(screen.getByText('LOCKED')).toBeInTheDocument();
    });

    it('does not show lock indicator when year is not locked', async () => {
      mockCheckYearLock.mockResolvedValue(false);
      mockGetLockedYears.mockResolvedValue(new Set());
      mockGetLists.mockResolvedValue(mockListsMetadata);
      mockGetList.mockResolvedValue(mockAlbums);
      mockGetGroups.mockResolvedValue(mockGroups);
      renderWithProviders();

      await waitFor(() => {
        expect(screen.getByTestId('list-header-title')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('list-header-lock')).not.toBeInTheDocument();
    });

    it('does not show lock indicator for non-main list even if year is locked', async () => {
      const nonMainList: Record<string, ListMetadata> = {
        list1: {
          ...mockListsMetadata.list1!,
          isMain: false,
        },
      };
      mockCheckYearLock.mockResolvedValue(true);
      mockGetLockedYears.mockResolvedValue(new Set([2024]));
      mockGetLists.mockResolvedValue(nonMainList);
      mockGetList.mockResolvedValue(mockAlbums);
      mockGetGroups.mockResolvedValue(mockGroups);
      renderWithProviders();

      await waitFor(() => {
        expect(screen.getByTestId('list-header-title')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('list-header-lock')).not.toBeInTheDocument();
    });
  });
});
