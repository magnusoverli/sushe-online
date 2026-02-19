import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { CoverImage } from '../CoverImage';

// Mock IntersectionObserver
const mockObserve = vi.fn();
const mockUnobserve = vi.fn();
const mockDisconnect = vi.fn();
let intersectionCallback: IntersectionObserverCallback;

beforeEach(() => {
  vi.clearAllMocks();
  // @ts-expect-error - mocking IntersectionObserver
  globalThis.IntersectionObserver = vi.fn((callback) => {
    intersectionCallback = callback;
    return {
      observe: mockObserve,
      unobserve: mockUnobserve,
      disconnect: mockDisconnect,
    };
  });
});

function simulateIntersection(isIntersecting: boolean) {
  intersectionCallback(
    [{ isIntersecting } as IntersectionObserverEntry],
    {} as IntersectionObserver
  );
}

describe('CoverImage', () => {
  it('renders container filling its parent', () => {
    render(<CoverImage src="/test.jpg" alt="Test" />);
    const container = screen.getByTestId('cover-image');
    expect(container).toBeInTheDocument();
    expect(container.style.width).toBe('100%');
    expect(container.style.height).toBe('100%');
  });

  it('does not render image until in viewport', () => {
    render(<CoverImage src="/test.jpg" alt="Test" />);
    expect(screen.queryByTestId('cover-img')).not.toBeInTheDocument();
  });

  it('renders image when intersection is observed', () => {
    render(<CoverImage src="/test.jpg" alt="Test" />);
    act(() => simulateIntersection(true));
    expect(screen.getByTestId('cover-img')).toBeInTheDocument();
  });

  it('fades in image on load', () => {
    render(<CoverImage src="/test.jpg" alt="Test" />);
    act(() => simulateIntersection(true));

    const img = screen.getByTestId('cover-img');
    expect(img.style.opacity).toBe('0');

    fireEvent.load(img);
    expect(img.style.opacity).toBe('1');
  });

  it('handles image error gracefully', () => {
    render(<CoverImage src="/bad.jpg" alt="Test" />);
    act(() => simulateIntersection(true));

    const img = screen.getByTestId('cover-img');
    fireEvent.error(img);

    // After error, image should not remain visible
    expect(screen.queryByTestId('cover-img')).not.toBeInTheDocument();
  });

  it('shows AI summary badge when hasSummary', () => {
    render(<CoverImage src="/test.jpg" alt="Test" hasSummary />);
    expect(screen.getByTestId('cover-summary-badge')).toBeInTheDocument();
  });

  it('fires onSummaryClick when badge clicked', () => {
    const onClick = vi.fn();
    render(
      <CoverImage
        src="/test.jpg"
        alt="Test"
        hasSummary
        onSummaryClick={onClick}
      />
    );
    fireEvent.click(screen.getByTestId('cover-summary-badge'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shows recommendation badge when hasRecommendation', () => {
    render(<CoverImage src="/test.jpg" alt="Test" hasRecommendation />);
    expect(
      screen.getByTestId('cover-recommendation-badge')
    ).toBeInTheDocument();
  });

  it('fires onRecommendationClick when badge clicked', () => {
    const onClick = vi.fn();
    render(
      <CoverImage
        src="/test.jpg"
        alt="Test"
        hasRecommendation
        onRecommendationClick={onClick}
      />
    );
    fireEvent.click(screen.getByTestId('cover-recommendation-badge'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('sets up IntersectionObserver with 200px rootMargin', () => {
    render(<CoverImage src="/test.jpg" alt="Test" />);
    expect(globalThis.IntersectionObserver).toHaveBeenCalledWith(
      expect.any(Function),
      { rootMargin: '200px' }
    );
  });

  it('does not render image when src is undefined', () => {
    render(<CoverImage src={undefined} alt="Test" />);
    simulateIntersection(true);
    expect(screen.queryByTestId('cover-img')).not.toBeInTheDocument();
  });
});
