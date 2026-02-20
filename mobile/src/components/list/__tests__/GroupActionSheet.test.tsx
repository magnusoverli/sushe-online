import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GroupActionSheet } from '../GroupActionSheet';
import type { Group } from '@/lib/types';

vi.mock('@/services/groups', () => ({
  updateGroup: vi.fn(() => Promise.resolve({ success: true })),
  deleteGroup: vi.fn(() => Promise.resolve({ success: true })),
}));

const mockCollection: Group = {
  _id: 'group-1',
  name: 'Favorites',
  sortOrder: 0,
  year: null,
  isYearGroup: false,
  listCount: 3,
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
};

const mockYearGroup: Group = {
  _id: 'group-2',
  name: '2024',
  sortOrder: 1,
  year: 2024,
  isYearGroup: true,
  listCount: 2,
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
};

describe('GroupActionSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders collection actions (rename + delete)', () => {
    render(<GroupActionSheet open onClose={vi.fn()} group={mockCollection} />);
    expect(screen.getByText('Rename')).toBeInTheDocument();
    expect(screen.getByText('Delete Collection')).toBeInTheDocument();
  });

  it('shows info text for year groups', () => {
    render(<GroupActionSheet open onClose={vi.fn()} group={mockYearGroup} />);
    expect(
      screen.getByText(/Year groups are managed automatically/)
    ).toBeInTheDocument();
    expect(screen.queryByText('Rename')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete Collection')).not.toBeInTheDocument();
  });

  it('shows inline rename input on Rename click', () => {
    render(<GroupActionSheet open onClose={vi.fn()} group={mockCollection} />);
    fireEvent.click(screen.getByText('Rename'));
    expect(screen.getByTestId('group-rename-input')).toBeInTheDocument();
    expect(screen.getByTestId('group-rename-input')).toHaveValue('Favorites');
  });

  it('shows delete confirmation with force checkbox for non-empty collections', async () => {
    const onClose = vi.fn();
    render(<GroupActionSheet open onClose={onClose} group={mockCollection} />);
    fireEvent.click(screen.getByText('Delete Collection'));

    await waitFor(() => {
      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
    });
    expect(screen.getByTestId('force-delete-checkbox')).toBeInTheDocument();
  });

  it('shows simple delete confirmation for empty collections', async () => {
    const emptyCollection = { ...mockCollection, listCount: 0 };
    const onClose = vi.fn();
    render(<GroupActionSheet open onClose={onClose} group={emptyCollection} />);
    fireEvent.click(screen.getByText('Delete Collection'));

    await waitFor(() => {
      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId('force-delete-checkbox')
    ).not.toBeInTheDocument();
  });
});
