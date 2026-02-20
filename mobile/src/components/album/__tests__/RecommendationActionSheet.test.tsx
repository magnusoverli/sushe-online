import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecommendationActionSheet } from '../RecommendationActionSheet';
import type { Recommendation, User } from '@/lib/types';

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

// Mock the recommendation hooks
const mockEditMutateAsync = vi.fn();
const mockRemoveMutateAsync = vi.fn();
vi.mock('@/hooks/useRecommendations', () => ({
  useEditReasoning: () => ({
    mutateAsync: mockEditMutateAsync,
    isPending: false,
  }),
  useRemoveRecommendation: () => ({
    mutateAsync: mockRemoveMutateAsync,
    isPending: false,
  }),
}));

const mockRec: Recommendation = {
  _id: 'rec1',
  album_id: 'album1',
  artist: 'Test Artist',
  album: 'Test Album',
  release_date: '2024-01-15',
  country: 'US',
  genre_1: 'Rock',
  genre_2: 'Indie',
  recommended_by: 'JohnDoe',
  recommender_id: 'user1',
  reasoning: 'Great album with amazing instrumentation.',
  created_at: '2024-03-15T10:00:00Z',
};

const mockRecNoReasoning: Recommendation = {
  ...mockRec,
  _id: 'rec2',
  reasoning: '',
};

const ownerUser: User = {
  _id: 'user1',
  email: 'john@test.com',
  username: 'JohnDoe',
  role: 'user',
};

const adminUser: User = {
  _id: 'admin1',
  email: 'admin@test.com',
  username: 'Admin',
  role: 'admin',
};

const otherUser: User = {
  _id: 'user2',
  email: 'jane@test.com',
  username: 'JaneDoe',
  role: 'user',
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

describe('RecommendationActionSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not render when recommendation is null', () => {
    render(
      <Wrapper>
        <RecommendationActionSheet
          open={true}
          onClose={vi.fn()}
          recommendation={null}
          year={2024}
          locked={false}
          user={ownerUser}
          onAddToList={vi.fn()}
          onViewReasoning={vi.fn()}
        />
      </Wrapper>
    );
    expect(screen.queryByText('Recommendation')).not.toBeInTheDocument();
  });

  it('should render action items when open', () => {
    render(
      <Wrapper>
        <RecommendationActionSheet
          open={true}
          onClose={vi.fn()}
          recommendation={mockRec}
          year={2024}
          locked={false}
          user={ownerUser}
          onAddToList={vi.fn()}
          onViewReasoning={vi.fn()}
        />
      </Wrapper>
    );
    expect(screen.getByText('Add to List...')).toBeInTheDocument();
    expect(screen.getByText('View Reasoning')).toBeInTheDocument();
    expect(screen.getByText('Edit Reasoning')).toBeInTheDocument();
    expect(screen.getByText('Remove Recommendation')).toBeInTheDocument();
  });

  it('should show "Add Reasoning" when no reasoning exists for owner', () => {
    render(
      <Wrapper>
        <RecommendationActionSheet
          open={true}
          onClose={vi.fn()}
          recommendation={mockRecNoReasoning}
          year={2024}
          locked={false}
          user={ownerUser}
          onAddToList={vi.fn()}
          onViewReasoning={vi.fn()}
        />
      </Wrapper>
    );
    expect(screen.getByText('Add Reasoning')).toBeInTheDocument();
    expect(screen.queryByText('View Reasoning')).not.toBeInTheDocument();
  });

  it('should not show edit/remove for non-owner non-admin', () => {
    render(
      <Wrapper>
        <RecommendationActionSheet
          open={true}
          onClose={vi.fn()}
          recommendation={mockRec}
          year={2024}
          locked={false}
          user={otherUser}
          onAddToList={vi.fn()}
          onViewReasoning={vi.fn()}
        />
      </Wrapper>
    );
    expect(screen.getByText('Add to List...')).toBeInTheDocument();
    expect(screen.getByText('View Reasoning')).toBeInTheDocument();
    expect(screen.queryByText('Edit Reasoning')).not.toBeInTheDocument();
    expect(screen.queryByText('Remove Recommendation')).not.toBeInTheDocument();
  });

  it('should show remove for admin even when not owner', () => {
    render(
      <Wrapper>
        <RecommendationActionSheet
          open={true}
          onClose={vi.fn()}
          recommendation={mockRec}
          year={2024}
          locked={false}
          user={adminUser}
          onAddToList={vi.fn()}
          onViewReasoning={vi.fn()}
        />
      </Wrapper>
    );
    expect(screen.getByText('Remove Recommendation')).toBeInTheDocument();
    // Admin is not the owner, so no edit
    expect(screen.queryByText('Edit Reasoning')).not.toBeInTheDocument();
  });

  it('should show lock banner and hide edit/remove when locked', () => {
    render(
      <Wrapper>
        <RecommendationActionSheet
          open={true}
          onClose={vi.fn()}
          recommendation={mockRec}
          year={2024}
          locked={true}
          user={ownerUser}
          onAddToList={vi.fn()}
          onViewReasoning={vi.fn()}
        />
      </Wrapper>
    );
    expect(screen.getByTestId('rec-action-lock-banner')).toBeInTheDocument();
    expect(screen.getByText('Add to List...')).toBeInTheDocument();
    expect(screen.getByText('View Reasoning')).toBeInTheDocument();
    // Locked: no edit or remove
    expect(screen.queryByText('Edit Reasoning')).not.toBeInTheDocument();
    expect(screen.queryByText('Remove Recommendation')).not.toBeInTheDocument();
  });

  it('should call onAddToList when Add to List is clicked', () => {
    const onAddToList = vi.fn();
    const onClose = vi.fn();
    render(
      <Wrapper>
        <RecommendationActionSheet
          open={true}
          onClose={onClose}
          recommendation={mockRec}
          year={2024}
          locked={false}
          user={otherUser}
          onAddToList={onAddToList}
          onViewReasoning={vi.fn()}
        />
      </Wrapper>
    );
    fireEvent.click(screen.getByText('Add to List...'));
    expect(onClose).toHaveBeenCalled();
  });

  it('should switch to edit mode when Edit Reasoning is clicked', () => {
    render(
      <Wrapper>
        <RecommendationActionSheet
          open={true}
          onClose={vi.fn()}
          recommendation={mockRec}
          year={2024}
          locked={false}
          user={ownerUser}
          onAddToList={vi.fn()}
          onViewReasoning={vi.fn()}
        />
      </Wrapper>
    );
    fireEvent.click(screen.getByText('Edit Reasoning'));
    expect(screen.getByTestId('rec-edit-textarea')).toBeInTheDocument();
    expect(screen.getByTestId('rec-edit-save')).toBeInTheDocument();
    expect(screen.getByTestId('rec-edit-cancel')).toBeInTheDocument();
  });

  it('should pre-populate textarea with existing reasoning in edit mode', () => {
    render(
      <Wrapper>
        <RecommendationActionSheet
          open={true}
          onClose={vi.fn()}
          recommendation={mockRec}
          year={2024}
          locked={false}
          user={ownerUser}
          onAddToList={vi.fn()}
          onViewReasoning={vi.fn()}
        />
      </Wrapper>
    );
    fireEvent.click(screen.getByText('Edit Reasoning'));
    const textarea = screen.getByTestId(
      'rec-edit-textarea'
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Great album with amazing instrumentation.');
  });

  it('should call editMutation on save', async () => {
    mockEditMutateAsync.mockResolvedValue({ success: true });
    render(
      <Wrapper>
        <RecommendationActionSheet
          open={true}
          onClose={vi.fn()}
          recommendation={mockRec}
          year={2024}
          locked={false}
          user={ownerUser}
          onAddToList={vi.fn()}
          onViewReasoning={vi.fn()}
        />
      </Wrapper>
    );
    fireEvent.click(screen.getByText('Edit Reasoning'));
    const textarea = screen.getByTestId('rec-edit-textarea');
    fireEvent.change(textarea, { target: { value: 'Updated reasoning' } });
    fireEvent.click(screen.getByTestId('rec-edit-save'));

    expect(mockEditMutateAsync).toHaveBeenCalledWith({
      year: 2024,
      albumId: 'album1',
      reasoning: 'Updated reasoning',
    });
  });
});
