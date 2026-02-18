import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SkeletonCard, SkeletonList } from '../SkeletonCard';

describe('SkeletonCard', () => {
  it('renders a skeleton card', () => {
    render(<SkeletonCard />);
    expect(screen.getByTestId('skeleton-card')).toBeInTheDocument();
  });

  it('shows rank placeholder by default', () => {
    const { container } = render(<SkeletonCard />);
    const skeletonElements = container.querySelectorAll('.skeleton');
    // rank + cover + title + artist + 2 tags = 6
    expect(skeletonElements.length).toBe(6);
  });

  it('hides rank placeholder when showRank is false', () => {
    const { container } = render(<SkeletonCard showRank={false} />);
    const skeletonElements = container.querySelectorAll('.skeleton');
    // cover + title + artist + 2 tags = 5
    expect(skeletonElements.length).toBe(5);
  });
});

describe('SkeletonList', () => {
  it('renders default 8 skeleton cards', () => {
    render(<SkeletonList />);
    expect(screen.getByTestId('skeleton-list')).toBeInTheDocument();
    expect(screen.getAllByTestId('skeleton-card')).toHaveLength(8);
  });

  it('renders custom count of skeleton cards', () => {
    render(<SkeletonList count={3} />);
    expect(screen.getAllByTestId('skeleton-card')).toHaveLength(3);
  });
});
