import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ListHeader } from '../ListHeader';

describe('ListHeader', () => {
  it('renders title', () => {
    render(<ListHeader title="Best of 2024" />);
    expect(screen.getByTestId('list-header-title')).toHaveTextContent(
      'Best of 2024'
    );
  });

  it('shows album count in metadata', () => {
    render(<ListHeader title="Main" albumCount={42} />);
    expect(screen.getByTestId('list-header-meta')).toHaveTextContent(
      '42 albums'
    );
  });

  it('uses singular "album" for count of 1', () => {
    render(<ListHeader title="Main" albumCount={1} />);
    expect(screen.getByTestId('list-header-meta')).toHaveTextContent('1 album');
  });

  it('shows year in metadata', () => {
    render(<ListHeader title="Main" albumCount={10} year={2024} />);
    expect(screen.getByTestId('list-header-meta')).toHaveTextContent(
      '10 albums · 2024'
    );
  });

  it('hides metadata when no count or year', () => {
    render(<ListHeader title="Main" />);
    expect(screen.queryByTestId('list-header-meta')).not.toBeInTheDocument();
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
