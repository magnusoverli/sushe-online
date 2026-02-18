import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabBar } from '../TabBar';

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

describe('TabBar', () => {
  it('renders three tabs', () => {
    render(<TabBar activeTab="library" />);
    expect(screen.getByTestId('tab-bar')).toBeInTheDocument();
    expect(screen.getByTestId('tab-library')).toBeInTheDocument();
    expect(screen.getByTestId('tab-search')).toBeInTheDocument();
    expect(screen.getByTestId('tab-queue')).toBeInTheDocument();
  });

  it('marks active tab with aria-selected', () => {
    render(<TabBar activeTab="search" />);
    expect(screen.getByTestId('tab-search')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByTestId('tab-library')).toHaveAttribute(
      'aria-selected',
      'false'
    );
  });

  it('renders tab labels', () => {
    render(<TabBar activeTab="library" />);
    expect(screen.getByText('Library')).toBeInTheDocument();
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByText('Queue')).toBeInTheDocument();
  });

  it('navigates on tab click', () => {
    render(<TabBar activeTab="library" />);
    fireEvent.click(screen.getByTestId('tab-search'));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/search' });
  });

  it('navigates to / on library tab click', () => {
    render(<TabBar activeTab="search" />);
    fireEvent.click(screen.getByTestId('tab-library'));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/' });
  });

  it('has role=tablist on the nav element', () => {
    render(<TabBar activeTab="library" />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });
});
