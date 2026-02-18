import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecommendationCard } from '../RecommendationCard';
import type { Recommendation } from '@/lib/types';

// Mock CoverImage to avoid IntersectionObserver dependency
vi.mock('../CoverImage', () => ({
  CoverImage: ({ alt }: { alt: string }) => (
    <div data-testid="cover-image">{alt}</div>
  ),
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
  reasoning: 'This album changed my perspective on music.',
  created_at: '2024-03-15T10:00:00Z',
};

const mockRecNoReasoning: Recommendation = {
  ...mockRec,
  _id: 'rec2',
  reasoning: '',
};

describe('RecommendationCard', () => {
  it('should render album title and artist', () => {
    render(
      <RecommendationCard recommendation={mockRec} onMenuClick={vi.fn()} />
    );
    expect(screen.getByTestId('rec-card-title')).toHaveTextContent(
      'Test Album'
    );
    expect(screen.getByTestId('rec-card-artist')).toHaveTextContent(
      'Test Artist'
    );
  });

  it('should render the recommender name', () => {
    render(
      <RecommendationCard recommendation={mockRec} onMenuClick={vi.fn()} />
    );
    expect(screen.getByTestId('rec-card-recommender')).toHaveTextContent(
      'JohnDoe'
    );
  });

  it('should render reasoning excerpt when reasoning exists', () => {
    render(
      <RecommendationCard recommendation={mockRec} onMenuClick={vi.fn()} />
    );
    expect(screen.getByTestId('rec-card-reasoning')).toBeInTheDocument();
    expect(screen.getByTestId('rec-card-reasoning')).toHaveTextContent(
      'This album changed my perspective on music.'
    );
  });

  it('should not render reasoning when reasoning is empty', () => {
    render(
      <RecommendationCard
        recommendation={mockRecNoReasoning}
        onMenuClick={vi.fn()}
      />
    );
    expect(screen.queryByTestId('rec-card-reasoning')).not.toBeInTheDocument();
  });

  it('should call onMenuClick when menu button is clicked', () => {
    const onMenuClick = vi.fn();
    render(
      <RecommendationCard recommendation={mockRec} onMenuClick={onMenuClick} />
    );
    fireEvent.click(screen.getByTestId('rec-card-menu-button'));
    expect(onMenuClick).toHaveBeenCalledWith(mockRec);
  });

  it('should call onReasoningClick when reasoning is tapped', () => {
    const onReasoningClick = vi.fn();
    render(
      <RecommendationCard
        recommendation={mockRec}
        onMenuClick={vi.fn()}
        onReasoningClick={onReasoningClick}
      />
    );
    fireEvent.click(screen.getByTestId('rec-card-reasoning'));
    expect(onReasoningClick).toHaveBeenCalledWith(mockRec);
  });

  it('should render genre information', () => {
    render(
      <RecommendationCard recommendation={mockRec} onMenuClick={vi.fn()} />
    );
    const card = screen.getByTestId('recommendation-card');
    expect(card).toHaveTextContent('Rock, Indie');
  });

  it('should have role=listitem', () => {
    render(
      <RecommendationCard recommendation={mockRec} onMenuClick={vi.fn()} />
    );
    expect(screen.getByTestId('recommendation-card')).toHaveAttribute(
      'role',
      'listitem'
    );
  });
});
