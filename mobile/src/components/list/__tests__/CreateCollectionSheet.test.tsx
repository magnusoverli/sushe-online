import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CreateCollectionSheet } from '../CreateCollectionSheet';

vi.mock('@/services/groups', () => ({
  createGroup: vi.fn(() =>
    Promise.resolve({
      _id: 'new-group',
      name: 'New',
      sortOrder: 0,
      year: null,
      isYearGroup: false,
      listCount: 0,
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    })
  ),
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
async function getCreateGroup() {
  const mod = await import('@/services/groups');
  return mod.createGroup as ReturnType<typeof vi.fn>;
}

describe('CreateCollectionSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders form when open', () => {
    render(<CreateCollectionSheet open onClose={vi.fn()} />);
    expect(screen.getByTestId('create-collection-name')).toBeInTheDocument();
    expect(screen.getByTestId('create-collection-submit')).toBeInTheDocument();
  });

  it('shows error when name is empty', async () => {
    render(<CreateCollectionSheet open onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('create-collection-submit'));
    const createGroup = await getCreateGroup();
    expect(createGroup).not.toHaveBeenCalled();
  });

  it('rejects 4-digit year names', async () => {
    render(<CreateCollectionSheet open onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('create-collection-name'), {
      target: { value: '2024' },
    });
    fireEvent.click(screen.getByTestId('create-collection-submit'));
    const createGroup = await getCreateGroup();
    expect(createGroup).not.toHaveBeenCalled();
  });

  it('creates collection with valid name', async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    render(
      <CreateCollectionSheet open onClose={onClose} onCreated={onCreated} />
    );

    fireEvent.change(screen.getByTestId('create-collection-name'), {
      target: { value: 'My Collection' },
    });
    fireEvent.click(screen.getByTestId('create-collection-submit'));

    const createGroup = await getCreateGroup();
    await waitFor(() => {
      expect(createGroup).toHaveBeenCalledWith('My Collection');
    });
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
    });
  });

  it('resets input on reopen', () => {
    const { rerender } = render(
      <CreateCollectionSheet open onClose={vi.fn()} />
    );

    fireEvent.change(screen.getByTestId('create-collection-name'), {
      target: { value: 'Something' },
    });

    rerender(<CreateCollectionSheet open={false} onClose={vi.fn()} />);
    rerender(<CreateCollectionSheet open onClose={vi.fn()} />);

    expect(screen.getByTestId('create-collection-name')).toHaveValue('');
  });
});
