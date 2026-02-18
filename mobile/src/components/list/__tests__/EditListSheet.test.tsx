import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EditListSheet } from '../EditListSheet';
import type { ListMetadata } from '@/lib/types';

vi.mock('@/services/lists', () => ({
  updateList: vi.fn(() => Promise.resolve({ success: true })),
}));

async function getUpdateList() {
  const mod = await import('@/services/lists');
  return mod.updateList as ReturnType<typeof vi.fn>;
}

const mockList: ListMetadata = {
  _id: 'list-1',
  name: 'Test List',
  year: 2024,
  isMain: false,
  count: 10,
  groupId: 'group-1',
  sortOrder: 0,
  updatedAt: '2024-01-01',
  createdAt: '2024-01-01',
};

describe('EditListSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pre-fills name and year from list', () => {
    render(<EditListSheet open onClose={vi.fn()} list={mockList} />);
    expect(screen.getByTestId('edit-list-name')).toHaveValue('Test List');
    expect(screen.getByTestId('edit-list-year')).toHaveValue(2024);
  });

  it('closes without saving if nothing changed', async () => {
    const onClose = vi.fn();
    render(<EditListSheet open onClose={onClose} list={mockList} />);
    fireEvent.click(screen.getByTestId('edit-list-submit'));
    const updateList = await getUpdateList();
    expect(updateList).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('saves name change', async () => {
    const onUpdated = vi.fn();
    const onClose = vi.fn();
    render(
      <EditListSheet
        open
        onClose={onClose}
        list={mockList}
        onUpdated={onUpdated}
      />
    );

    fireEvent.change(screen.getByTestId('edit-list-name'), {
      target: { value: 'Updated Name' },
    });
    fireEvent.click(screen.getByTestId('edit-list-submit'));

    const updateList = await getUpdateList();
    await waitFor(() => {
      expect(updateList).toHaveBeenCalledWith('list-1', {
        name: 'Updated Name',
      });
    });
    await waitFor(() => {
      expect(onUpdated).toHaveBeenCalled();
    });
  });

  it('rejects empty name', async () => {
    render(<EditListSheet open onClose={vi.fn()} list={mockList} />);
    fireEvent.change(screen.getByTestId('edit-list-name'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByTestId('edit-list-submit'));
    const updateList = await getUpdateList();
    expect(updateList).not.toHaveBeenCalled();
  });

  it('rejects invalid year', async () => {
    render(<EditListSheet open onClose={vi.fn()} list={mockList} />);
    fireEvent.change(screen.getByTestId('edit-list-year'), {
      target: { value: '999' },
    });
    fireEvent.click(screen.getByTestId('edit-list-submit'));
    const updateList = await getUpdateList();
    expect(updateList).not.toHaveBeenCalled();
  });
});
