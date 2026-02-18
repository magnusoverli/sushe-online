import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DrawerContent } from '../DrawerContent';
import type { Group, ListMetadata } from '@/lib/types';

function makeGroup(overrides: Partial<Group> = {}): Group {
  return {
    _id: 'g1',
    name: 'My Collection',
    sortOrder: 0,
    year: null,
    isYearGroup: false,
    listCount: 2,
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
    ...overrides,
  };
}

function makeList(overrides: Partial<ListMetadata> = {}): ListMetadata {
  return {
    _id: 'l1',
    name: 'Test List',
    year: null,
    isMain: false,
    count: 5,
    groupId: 'g1',
    sortOrder: 0,
    updatedAt: '2025-01-01',
    createdAt: '2025-01-01',
    ...overrides,
  };
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

describe('DrawerContent', () => {
  const defaultProps = {
    activeListId: null,
    lockedYears: new Set<number>(),
    onSelectList: vi.fn(),
    onGroupContextMenu: vi.fn(),
    onCloseDrawer: vi.fn(),
  };

  it('renders grouped list items with group headers', () => {
    const group = makeGroup({ _id: 'g1', name: 'Favorites' });
    const list1 = makeList({ _id: 'l1', name: 'Best Of', groupId: 'g1' });
    const list2 = makeList({ _id: 'l2', name: 'Runner Up', groupId: 'g1' });

    renderWithClient(
      <DrawerContent
        {...defaultProps}
        sections={[{ group, lists: [list1, list2] }]}
      />
    );

    expect(screen.getByText('Favorites')).toBeInTheDocument();
  });

  it('renders uncategorized lists without group header', () => {
    const list = makeList({ _id: 'l1', name: 'Orphan List', groupId: null });

    renderWithClient(
      <DrawerContent
        {...defaultProps}
        sections={[{ group: null, lists: [list] }]}
      />
    );

    expect(screen.getByText('Orphan List')).toBeInTheDocument();
    expect(screen.queryByTestId('group-accordion')).not.toBeInTheDocument();
  });

  it('renders drag handles on list items within expanded groups', () => {
    const group = makeGroup({ _id: 'g1', name: 'Collection' });
    const list = makeList({ _id: 'l1', name: 'My List', groupId: 'g1' });

    renderWithClient(
      <DrawerContent
        {...defaultProps}
        activeListId="l1"
        sections={[{ group, lists: [list] }]}
      />
    );

    // Group auto-expands because activeListId matches a list in it
    // Drag handles should be visible on the list items
    const handles = screen.getAllByTestId('drawer-drag-handle');
    expect(handles.length).toBeGreaterThan(0);
  });

  it('renders drag handles on group headers', () => {
    const group = makeGroup({ _id: 'g1', name: 'Collection' });
    const list = makeList({ _id: 'l1', name: 'My List', groupId: 'g1' });

    renderWithClient(
      <DrawerContent {...defaultProps} sections={[{ group, lists: [list] }]} />
    );

    const handles = screen.getAllByTestId('group-drag-handle');
    expect(handles.length).toBeGreaterThan(0);
  });

  it('highlights active list', () => {
    const group = makeGroup({ _id: 'g1', name: 'Collection' });
    const list1 = makeList({ _id: 'l1', name: 'Active', groupId: 'g1' });
    const list2 = makeList({ _id: 'l2', name: 'Inactive', groupId: 'g1' });

    renderWithClient(
      <DrawerContent
        {...defaultProps}
        activeListId="l1"
        sections={[{ group, lists: [list1, list2] }]}
      />
    );

    // The group with the active list should auto-expand
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('calls onSelectList when a list item is clicked', () => {
    const onSelectList = vi.fn();
    const list = makeList({ _id: 'l1', name: 'Click Me', groupId: null });

    renderWithClient(
      <DrawerContent
        {...defaultProps}
        onSelectList={onSelectList}
        sections={[{ group: null, lists: [list] }]}
      />
    );

    screen.getByText('Click Me').click();
    expect(onSelectList).toHaveBeenCalledWith('l1');
  });

  it('renders multiple groups and uncategorized sections', () => {
    const group1 = makeGroup({ _id: 'g1', name: 'Group A' });
    const group2 = makeGroup({ _id: 'g2', name: 'Group B' });
    const list1 = makeList({ _id: 'l1', name: 'List 1', groupId: 'g1' });
    const list2 = makeList({ _id: 'l2', name: 'List 2', groupId: 'g2' });
    const orphan = makeList({ _id: 'l3', name: 'Orphan', groupId: null });

    renderWithClient(
      <DrawerContent
        {...defaultProps}
        sections={[
          { group: group1, lists: [list1] },
          { group: group2, lists: [list2] },
          { group: null, lists: [orphan] },
        ]}
      />
    );

    expect(screen.getByText('Group A')).toBeInTheDocument();
    expect(screen.getByText('Group B')).toBeInTheDocument();
    expect(screen.getByText('Orphan')).toBeInTheDocument();
  });

  it('renders the drawer-content test id', () => {
    renderWithClient(<DrawerContent {...defaultProps} sections={[]} />);

    expect(screen.getByTestId('drawer-content')).toBeInTheDocument();
  });
});
