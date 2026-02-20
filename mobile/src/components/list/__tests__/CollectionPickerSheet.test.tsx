import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CollectionPickerSheet } from '../CollectionPickerSheet';
import type { Group } from '@/lib/types';

vi.mock('@/services/lists', () => ({
  moveList: vi.fn(() => Promise.resolve({ success: true })),
}));

const mockGroups: Group[] = [
  {
    _id: 'g1',
    name: '2024',
    sortOrder: 0,
    year: 2024,
    isYearGroup: true,
    listCount: 2,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  },
  {
    _id: 'g2',
    name: 'Favorites',
    sortOrder: 1,
    year: null,
    isYearGroup: false,
    listCount: 1,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  },
  {
    _id: 'g3',
    name: 'Archive',
    sortOrder: 2,
    year: null,
    isYearGroup: false,
    listCount: 0,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  },
];

describe('CollectionPickerSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows only non-year groups as options', () => {
    render(
      <CollectionPickerSheet
        open
        onClose={vi.fn()}
        listId="list-1"
        listName="My List"
        currentGroupId="g2"
        groups={mockGroups}
      />
    );
    expect(screen.getByText('Favorites')).toBeInTheDocument();
    expect(screen.getByText('Archive')).toBeInTheDocument();
    // Year group should not appear
    expect(screen.queryByText('2024')).not.toBeInTheDocument();
  });

  it('disables current collection', () => {
    render(
      <CollectionPickerSheet
        open
        onClose={vi.fn()}
        listId="list-1"
        listName="My List"
        currentGroupId="g2"
        groups={mockGroups}
      />
    );
    // Find the Favorites button - it should be disabled
    const items = screen.getAllByTestId('action-item');
    const favoritesItem = items.find((el) =>
      el.textContent?.includes('Favorites')
    );
    expect(favoritesItem).toBeDisabled();
  });

  it('moves list to a different collection on click', async () => {
    const onMoved = vi.fn();
    const onClose = vi.fn();
    render(
      <CollectionPickerSheet
        open
        onClose={onClose}
        listId="list-1"
        listName="My List"
        currentGroupId="g2"
        groups={mockGroups}
        onMoved={onMoved}
      />
    );
    // Click Archive
    const items = screen.getAllByTestId('action-item');
    const archiveItem = items.find((el) => el.textContent?.includes('Archive'));
    fireEvent.click(archiveItem!);

    const { moveList } = await import('@/services/lists');
    await waitFor(() => {
      expect(moveList).toHaveBeenCalledWith('list-1', { groupId: 'g3' });
    });
    await waitFor(() => {
      expect(onMoved).toHaveBeenCalled();
    });
  });

  it('shows empty message when no collections exist', () => {
    const yearOnlyGroups = mockGroups.filter((g) => g.isYearGroup);
    render(
      <CollectionPickerSheet
        open
        onClose={vi.fn()}
        listId="list-1"
        listName="My List"
        currentGroupId={null}
        groups={yearOnlyGroups}
      />
    );
    expect(screen.getByText(/No collections available/)).toBeInTheDocument();
  });
});
