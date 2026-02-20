import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecommendAlbumSheet } from '../RecommendAlbumSheet';
import type { Album } from '@/lib/types';

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      style,
      ...props
    }: {
      children: React.ReactNode;
      style?: React.CSSProperties;
      [key: string]: unknown;
    }) => (
      <div style={style} {...props}>
        {children}
      </div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

// Mock the recommendations hook
const mockMutateAsync = vi.fn();
vi.mock('@/hooks/useRecommendations', () => ({
  useAddRecommendation: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}));

const mockAlbum: Album = {
  _id: 'item1',
  album_id: 'album1',
  artist: 'Test Artist',
  album: 'Test Album',
  release_date: '2024',
  country: 'US',
  genre_1: 'Rock',
  genre_2: '',
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

describe('RecommendAlbumSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not render when album is null', () => {
    render(
      <Wrapper>
        <RecommendAlbumSheet
          open={true}
          onClose={vi.fn()}
          album={null}
          year={2024}
        />
      </Wrapper>
    );
    expect(screen.queryByText('Recommend Album')).not.toBeInTheDocument();
  });

  it('should not render when year is null', () => {
    render(
      <Wrapper>
        <RecommendAlbumSheet
          open={true}
          onClose={vi.fn()}
          album={mockAlbum}
          year={null}
        />
      </Wrapper>
    );
    expect(screen.queryByText('Recommend Album')).not.toBeInTheDocument();
  });

  it('should render when open with album and year', () => {
    render(
      <Wrapper>
        <RecommendAlbumSheet
          open={true}
          onClose={vi.fn()}
          album={mockAlbum}
          year={2024}
        />
      </Wrapper>
    );
    expect(
      screen.getByText('Recommending to the 2024 list')
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('Share your reasoning...')
    ).toBeInTheDocument();
  });

  it('should show character count', () => {
    render(
      <Wrapper>
        <RecommendAlbumSheet
          open={true}
          onClose={vi.fn()}
          album={mockAlbum}
          year={2024}
        />
      </Wrapper>
    );
    expect(screen.getByText('0/500')).toBeInTheDocument();
  });

  it('should update character count as user types', () => {
    render(
      <Wrapper>
        <RecommendAlbumSheet
          open={true}
          onClose={vi.fn()}
          album={mockAlbum}
          year={2024}
        />
      </Wrapper>
    );
    const textarea = screen.getByPlaceholderText('Share your reasoning...');
    fireEvent.change(textarea, { target: { value: 'Great album!' } });
    expect(screen.getByText('12/500')).toBeInTheDocument();
  });

  it('should disable submit button when reasoning is empty', () => {
    render(
      <Wrapper>
        <RecommendAlbumSheet
          open={true}
          onClose={vi.fn()}
          album={mockAlbum}
          year={2024}
        />
      </Wrapper>
    );
    const button = screen.getByText('Recommend');
    expect(button).toBeDisabled();
  });

  it('should enable submit button when reasoning is entered', () => {
    render(
      <Wrapper>
        <RecommendAlbumSheet
          open={true}
          onClose={vi.fn()}
          album={mockAlbum}
          year={2024}
        />
      </Wrapper>
    );
    const textarea = screen.getByPlaceholderText('Share your reasoning...');
    fireEvent.change(textarea, { target: { value: 'Great album!' } });
    const button = screen.getByText('Recommend');
    expect(button).not.toBeDisabled();
  });

  it('should call mutateAsync with correct params on submit', async () => {
    mockMutateAsync.mockResolvedValue({ success: true });
    const onClose = vi.fn();

    render(
      <Wrapper>
        <RecommendAlbumSheet
          open={true}
          onClose={onClose}
          album={mockAlbum}
          year={2024}
        />
      </Wrapper>
    );

    const textarea = screen.getByPlaceholderText('Share your reasoning...');
    fireEvent.change(textarea, { target: { value: 'Great album!' } });

    const button = screen.getByText('Recommend');
    fireEvent.click(button);

    expect(mockMutateAsync).toHaveBeenCalledWith({
      year: 2024,
      album: {
        artist: 'Test Artist',
        album: 'Test Album',
        release_date: '2024',
        country: 'US',
        genre_1: 'Rock',
        genre_2: '',
      },
      reasoning: 'Great album!',
    });
  });
});
