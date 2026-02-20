import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecommendationInfoSheet } from '../RecommendationInfoSheet';

describe('RecommendationInfoSheet', () => {
  it('shows album info', () => {
    render(
      <RecommendationInfoSheet
        open={true}
        onClose={vi.fn()}
        albumName="Blackwater Park"
        artistName="Opeth"
        recommendedBy="magnusO"
        recommendedAt="2025-01-15"
      />
    );

    expect(screen.getByText('Blackwater Park')).toBeInTheDocument();
    expect(screen.getByText('Opeth')).toBeInTheDocument();
  });

  it('shows recommender name', () => {
    render(
      <RecommendationInfoSheet
        open={true}
        onClose={vi.fn()}
        albumName="Blackwater Park"
        artistName="Opeth"
        recommendedBy="magnusO"
        recommendedAt="2025-01-15"
      />
    );

    expect(screen.getByText('magnusO')).toBeInTheDocument();
  });

  it('shows formatted date', () => {
    render(
      <RecommendationInfoSheet
        open={true}
        onClose={vi.fn()}
        albumName="Blackwater Park"
        artistName="Opeth"
        recommendedBy="magnusO"
        recommendedAt="2025-01-15"
      />
    );

    expect(screen.getByText(/January 15, 2025/)).toBeInTheDocument();
  });

  it('shows fallback when no recommendation info', () => {
    render(
      <RecommendationInfoSheet
        open={true}
        onClose={vi.fn()}
        albumName="Blackwater Park"
        artistName="Opeth"
        recommendedBy={null}
        recommendedAt={null}
      />
    );

    expect(
      screen.getByText('No recommendation info available.')
    ).toBeInTheDocument();
  });
});
