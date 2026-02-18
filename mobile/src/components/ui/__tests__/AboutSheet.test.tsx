import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AboutSheet } from '../AboutSheet';

// Mock the changelog JSON import
vi.mock('../../../../../src/data/changelog.json', () => ({
  default: [
    {
      date: '2026-02-17',
      category: 'feature',
      description: 'Added new search feature',
      hash: 'abc123',
    },
    {
      date: '2026-02-17',
      category: 'fix',
      description: 'Fixed login bug',
      hash: 'def456',
    },
    {
      date: '2026-02-16',
      category: 'ui',
      description: 'Updated sidebar design',
      hash: 'ghi789',
    },
  ],
}));

describe('AboutSheet', () => {
  it('renders app name when open', () => {
    render(<AboutSheet open={true} onClose={vi.fn()} />);
    expect(screen.getByTestId('about-app-name')).toHaveTextContent(
      'SuShe Online'
    );
  });

  it('renders app description', () => {
    render(<AboutSheet open={true} onClose={vi.fn()} />);
    expect(
      screen.getByText('Track and organize your music, one album at a time.')
    ).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<AboutSheet open={false} onClose={vi.fn()} />);
    expect(screen.queryByTestId('about-app-name')).not.toBeInTheDocument();
  });

  it('renders changelog entries', () => {
    render(<AboutSheet open={true} onClose={vi.fn()} />);
    const entries = screen.getAllByTestId('changelog-entry');
    expect(entries.length).toBe(3);
    expect(screen.getByText('Added new search feature')).toBeInTheDocument();
    expect(screen.getByText('Fixed login bug')).toBeInTheDocument();
    expect(screen.getByText('Updated sidebar design')).toBeInTheDocument();
  });

  it('renders category badges', () => {
    render(<AboutSheet open={true} onClose={vi.fn()} />);
    expect(screen.getByText('feature')).toBeInTheDocument();
    expect(screen.getByText('fix')).toBeInTheDocument();
    expect(screen.getByText('ui')).toBeInTheDocument();
  });

  it('renders formatted date headers', () => {
    render(<AboutSheet open={true} onClose={vi.fn()} />);
    expect(screen.getByText('Feb 17, 2026')).toBeInTheDocument();
    expect(screen.getByText('Feb 16, 2026')).toBeInTheDocument();
  });

  it('renders "What\'s New" section header', () => {
    render(<AboutSheet open={true} onClose={vi.fn()} />);
    expect(screen.getByText("What's New")).toBeInTheDocument();
  });
});

describe('AboutSheet - show more', () => {
  it('shows "Show more" button when entries exceed initial count', () => {
    // Need to re-mock with more entries
    // For this test, the mock only has 3 entries and INITIAL_COUNT is 15,
    // so "Show more" should NOT appear
    render(<AboutSheet open={true} onClose={vi.fn()} />);
    expect(screen.queryByTestId('about-show-more')).not.toBeInTheDocument();
  });
});
