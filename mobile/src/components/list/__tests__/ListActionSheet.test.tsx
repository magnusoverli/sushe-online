import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ListActionSheet } from '../ListActionSheet';
import type { ListMetadata, User } from '@/lib/types';

// Mock services
vi.mock('@/services/downloads', () => ({
  downloadListAsJSON: vi.fn(() => Promise.resolve()),
  downloadListAsCSV: vi.fn(() => Promise.resolve()),
  downloadListAsPDF: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/services/lists', () => ({
  deleteList: vi.fn(() => Promise.resolve({ success: true })),
  setMainList: vi.fn(() => Promise.resolve({ success: true })),
}));

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

const mockUser: User = {
  _id: 'user-1',
  email: 'test@example.com',
  username: 'testuser',
  role: 'user',
  spotifyConnected: true,
};

describe('ListActionSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders when open with list name as title', () => {
    render(
      <ListActionSheet open onClose={vi.fn()} list={mockList} user={mockUser} />
    );
    expect(screen.getByText('Test List')).toBeInTheDocument();
  });

  it('shows download action items', () => {
    render(
      <ListActionSheet open onClose={vi.fn()} list={mockList} user={mockUser} />
    );
    expect(screen.getByText('Download List...')).toBeInTheDocument();
  });

  it('expands download options on click', () => {
    render(
      <ListActionSheet open onClose={vi.fn()} list={mockList} user={mockUser} />
    );
    fireEvent.click(screen.getByText('Download List...'));
    expect(screen.getByText('Download as JSON')).toBeInTheDocument();
    expect(screen.getByText('Download as PDF')).toBeInTheDocument();
    expect(screen.getByText('Download as CSV')).toBeInTheDocument();
  });

  it('shows Edit Details action', () => {
    render(
      <ListActionSheet open onClose={vi.fn()} list={mockList} user={mockUser} />
    );
    expect(screen.getByText('Edit Details')).toBeInTheDocument();
  });

  it('shows Set as Main for year lists', () => {
    render(
      <ListActionSheet open onClose={vi.fn()} list={mockList} user={mockUser} />
    );
    expect(screen.getByText('Set as Main')).toBeInTheDocument();
  });

  it('shows Remove Main Status for main lists', () => {
    render(
      <ListActionSheet
        open
        onClose={vi.fn()}
        list={{ ...mockList, isMain: true }}
        user={mockUser}
      />
    );
    expect(screen.getByText('Remove Main Status')).toBeInTheDocument();
  });

  it('hides Set as Main for non-year lists', () => {
    render(
      <ListActionSheet
        open
        onClose={vi.fn()}
        list={{ ...mockList, year: null }}
        user={mockUser}
      />
    );
    expect(screen.queryByText('Set as Main')).not.toBeInTheDocument();
  });

  it('shows Send to Spotify for Spotify-connected users', () => {
    render(
      <ListActionSheet open onClose={vi.fn()} list={mockList} user={mockUser} />
    );
    expect(screen.getByText('Send to Spotify')).toBeInTheDocument();
  });

  it('shows Move to Collection for collection lists', () => {
    render(
      <ListActionSheet
        open
        onClose={vi.fn()}
        list={mockList}
        user={mockUser}
        isInCollection
      />
    );
    expect(screen.getByText('Move to Collection')).toBeInTheDocument();
  });

  it('hides Move to Collection by default', () => {
    render(
      <ListActionSheet open onClose={vi.fn()} list={mockList} user={mockUser} />
    );
    expect(screen.queryByText('Move to Collection')).not.toBeInTheDocument();
  });

  it('shows Delete List action', () => {
    render(
      <ListActionSheet open onClose={vi.fn()} list={mockList} user={mockUser} />
    );
    expect(screen.getByText('Delete List')).toBeInTheDocument();
  });

  it('shows delete confirmation dialog on Delete click', async () => {
    const onClose = vi.fn();
    render(
      <ListActionSheet open onClose={onClose} list={mockList} user={mockUser} />
    );
    fireEvent.click(screen.getByText('Delete List'));

    await waitFor(() => {
      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Are you sure you want to delete/)
    ).toBeInTheDocument();
  });
});
