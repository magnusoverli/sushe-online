import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AlbumCard } from '../AlbumCard';

describe('AlbumCard', () => {
  const defaultProps = {
    rank: 1,
    title: 'Kind of Blue',
    artist: 'Miles Davis',
    tags: ['1959', 'JAZZ'],
  };

  it('renders title, artist, rank, and tags', () => {
    render(<AlbumCard {...defaultProps} />);
    expect(screen.getByTestId('album-title')).toHaveTextContent('Kind of Blue');
    expect(screen.getByTestId('album-artist')).toHaveTextContent('Miles Davis');
    expect(screen.getByTestId('album-rank')).toHaveTextContent('1');
    expect(screen.getAllByTestId('tag-pill')).toHaveLength(2);
  });

  it('hides rank when showRank is false', () => {
    render(<AlbumCard {...defaultProps} showRank={false} />);
    expect(screen.queryByTestId('album-rank')).not.toBeInTheDocument();
  });

  it('shows active indicator when isActive is true', () => {
    render(<AlbumCard {...defaultProps} isActive />);
    const indicator = screen.getByTestId('active-indicator');
    expect(indicator.style.opacity).toBe('1');
  });

  it('hides active indicator by default', () => {
    render(<AlbumCard {...defaultProps} />);
    const indicator = screen.getByTestId('active-indicator');
    expect(indicator.style.opacity).toBe('0');
  });

  it('applies gold color to title when active', () => {
    render(<AlbumCard {...defaultProps} isActive />);
    const title = screen.getByTestId('album-title');
    expect(title.style.color).toBe('var(--color-gold)');
  });

  it('renders menu button when onMenuClick provided', () => {
    render(<AlbumCard {...defaultProps} onMenuClick={vi.fn()} />);
    expect(screen.getByTestId('album-menu-button')).toBeInTheDocument();
  });

  it('does not render menu button when onMenuClick not provided', () => {
    render(<AlbumCard {...defaultProps} />);
    expect(screen.queryByTestId('album-menu-button')).not.toBeInTheDocument();
  });

  it('calls onMenuClick with event stopPropagation', () => {
    const onMenuClick = vi.fn();
    const onClick = vi.fn();
    render(
      <AlbumCard
        {...defaultProps}
        onClick={onClick}
        onMenuClick={onMenuClick}
      />
    );
    fireEvent.click(screen.getByTestId('album-menu-button'));
    expect(onMenuClick).toHaveBeenCalledOnce();
    // stopPropagation means the card onClick should not fire
    expect(onClick).not.toHaveBeenCalled();
  });

  it('calls onClick when card is clicked', () => {
    const onClick = vi.fn();
    render(<AlbumCard {...defaultProps} onClick={onClick} />);
    fireEvent.click(screen.getByTestId('album-card'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('applies dragging state styles', () => {
    render(<AlbumCard {...defaultProps} cardState="dragging" />);
    const card = screen.getByTestId('album-card');
    expect(card.style.opacity).toBe('0.2');
    expect(card.style.transform).toContain('scale(0.97)');
  });

  it('applies dimmed state styles', () => {
    render(<AlbumCard {...defaultProps} cardState="dimmed" />);
    const card = screen.getByTestId('album-card');
    expect(card.style.opacity).toBe('0.55');
  });

  it('renders without tags', () => {
    render(<AlbumCard rank={1} title="Test" artist="Test Artist" />);
    expect(screen.queryByTestId('tag-pill')).not.toBeInTheDocument();
  });

  it('renders cover element when provided', () => {
    render(
      <AlbumCard
        {...defaultProps}
        coverElement={<div data-testid="cover">cover</div>}
      />
    );
    expect(screen.getByTestId('cover')).toBeInTheDocument();
  });

  it('renders playcount when provided and > 0', () => {
    render(<AlbumCard {...defaultProps} playcount={1500} />);
    const el = screen.getByTestId('album-playcount');
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent('1.5K');
    expect(el.title).toBe('1,500 plays on Last.fm');
  });

  it('does not render playcount when not provided', () => {
    render(<AlbumCard {...defaultProps} />);
    expect(screen.queryByTestId('album-playcount')).not.toBeInTheDocument();
  });

  it('does not render playcount when zero', () => {
    render(<AlbumCard {...defaultProps} playcount={0} />);
    expect(screen.queryByTestId('album-playcount')).not.toBeInTheDocument();
  });

  it('renders raw playcount for small numbers', () => {
    render(<AlbumCard {...defaultProps} playcount={42} />);
    const el = screen.getByTestId('album-playcount');
    expect(el).toHaveTextContent('42');
  });
});
