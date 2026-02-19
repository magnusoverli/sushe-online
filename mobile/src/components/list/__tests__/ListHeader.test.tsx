import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ListHeader, ListHeaderMeta } from '../ListHeader';

describe('ListHeader', () => {
  it('renders title', () => {
    render(<ListHeader title="Best of 2024" />);
    expect(screen.getByTestId('list-header-title')).toHaveTextContent(
      'Best of 2024'
    );
  });

  it('renders hamburger menu button', () => {
    const onClick = vi.fn();
    render(<ListHeader title="Main" onMenuClick={onClick} />);

    const button = screen.getByTestId('list-header-menu');
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('hides menu button when no handler', () => {
    render(<ListHeader title="Main" />);
    expect(screen.queryByTestId('list-header-menu')).not.toBeInTheDocument();
  });
});

describe('ListHeaderMeta', () => {
  it('shows album count', () => {
    render(<ListHeaderMeta albumCount={42} />);
    expect(screen.getByTestId('list-header-meta')).toHaveTextContent(
      '42 albums'
    );
  });

  it('uses singular "album" for count of 1', () => {
    render(<ListHeaderMeta albumCount={1} />);
    expect(screen.getByTestId('list-header-meta')).toHaveTextContent('1 album');
  });

  it('shows year in metadata', () => {
    render(<ListHeaderMeta albumCount={10} year={2024} />);
    expect(screen.getByTestId('list-header-meta')).toHaveTextContent(
      '10 albums · 2024'
    );
  });

  it('returns null when no count, year, lock, or sort control', () => {
    const { container } = render(<ListHeaderMeta />);
    expect(container.firstChild).toBeNull();
  });

  it('renders sort control', () => {
    render(
      <ListHeaderMeta
        albumCount={5}
        sortControl={<button data-testid="sort-btn">Sort</button>}
      />
    );
    expect(screen.getByTestId('sort-btn')).toBeInTheDocument();
  });

  it('shows lock badge when locked', () => {
    render(<ListHeaderMeta albumCount={5} isLocked />);
    expect(screen.getByTestId('list-header-lock')).toBeInTheDocument();
  });
});
