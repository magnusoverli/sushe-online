import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CreateListSheet } from '../CreateListSheet';
import type { Group } from '@/lib/types';

vi.mock('@/services/lists', () => ({
  createList: vi.fn(() =>
    Promise.resolve({
      success: true,
      _id: 'new-list',
      name: 'New',
      year: null,
      groupId: null,
      count: 0,
    })
  ),
}));

vi.mock('@/services/groups', () => ({
  createGroup: vi.fn(() =>
    Promise.resolve({
      _id: 'new-group',
      name: 'New Collection',
      sortOrder: 5,
      year: null,
      isYearGroup: false,
      listCount: 0,
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    })
  ),
}));

async function getCreateList() {
  const mod = await import('@/services/lists');
  return mod.createList as ReturnType<typeof vi.fn>;
}

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
];

describe('CreateListSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders form fields when open', () => {
    render(<CreateListSheet open onClose={vi.fn()} groups={mockGroups} />);
    expect(screen.getByTestId('create-list-name')).toBeInTheDocument();
    expect(screen.getByTestId('create-list-category')).toBeInTheDocument();
    expect(screen.getByTestId('create-list-submit')).toBeInTheDocument();
  });

  it('shows validation error when name is empty', async () => {
    render(<CreateListSheet open onClose={vi.fn()} groups={mockGroups} />);
    fireEvent.click(screen.getByTestId('create-list-submit'));
    const createList = await getCreateList();
    expect(createList).not.toHaveBeenCalled();
  });

  it('shows validation error when category not selected', async () => {
    render(<CreateListSheet open onClose={vi.fn()} groups={mockGroups} />);
    fireEvent.change(screen.getByTestId('create-list-name'), {
      target: { value: 'My List' },
    });
    fireEvent.click(screen.getByTestId('create-list-submit'));
    const createList = await getCreateList();
    expect(createList).not.toHaveBeenCalled();
  });

  it('creates list when form is valid', async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    render(
      <CreateListSheet
        open
        onClose={onClose}
        groups={mockGroups}
        onCreated={onCreated}
      />
    );

    fireEvent.change(screen.getByTestId('create-list-name'), {
      target: { value: 'My New List' },
    });
    fireEvent.change(screen.getByTestId('create-list-category'), {
      target: { value: 'g1' },
    });
    fireEvent.click(screen.getByTestId('create-list-submit'));

    const createList = await getCreateList();
    await waitFor(() => {
      expect(createList).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith('new-list');
    });
  });

  it('resets form on reopen', () => {
    const { rerender } = render(
      <CreateListSheet open onClose={vi.fn()} groups={mockGroups} />
    );

    fireEvent.change(screen.getByTestId('create-list-name'), {
      target: { value: 'Something' },
    });

    rerender(
      <CreateListSheet open={false} onClose={vi.fn()} groups={mockGroups} />
    );
    rerender(<CreateListSheet open onClose={vi.fn()} groups={mockGroups} />);

    expect(screen.getByTestId('create-list-name')).toHaveValue('');
  });
});
