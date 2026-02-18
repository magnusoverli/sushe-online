import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ListSelectionSheet } from '../ListSelectionSheet';
import type { ListMetadata, Group } from '@/lib/types';

const mockLists: Record<string, ListMetadata> = {
  'list-1': {
    _id: 'list-1',
    name: 'Current List',
    year: 2024,
    isMain: true,
    count: 10,
    groupId: 'g1',
    sortOrder: 0,
    updatedAt: '',
    createdAt: '',
  },
  'list-2': {
    _id: 'list-2',
    name: 'Target List A',
    year: 2024,
    isMain: false,
    count: 5,
    groupId: 'g1',
    sortOrder: 1,
    updatedAt: '',
    createdAt: '',
  },
  'list-3': {
    _id: 'list-3',
    name: 'Target List B',
    year: 2023,
    isMain: false,
    count: 8,
    groupId: null,
    sortOrder: 0,
    updatedAt: '',
    createdAt: '',
  },
  'list-4': {
    _id: 'list-4',
    name: 'No Year List',
    year: null,
    isMain: false,
    count: 3,
    groupId: null,
    sortOrder: 0,
    updatedAt: '',
    createdAt: '',
  },
};

const mockGroups: Group[] = [
  {
    _id: 'g1',
    name: '2024',
    sortOrder: 0,
    year: 2024,
    isYearGroup: true,
    listCount: 2,
    createdAt: '',
    updatedAt: '',
  },
];

describe('ListSelectionSheet', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    title: 'Move to List',
    albumName: 'Blackwater Park',
    artistName: 'Opeth',
    currentListId: 'list-1',
    lists: mockLists,
    groups: mockGroups,
    onSelect: vi.fn(),
  };

  it('renders title and album info', () => {
    render(<ListSelectionSheet {...defaultProps} />);
    expect(screen.getByText('Move to List')).toBeInTheDocument();
    expect(screen.getByText(/Opeth/)).toBeInTheDocument();
  });

  it('excludes current list from options', () => {
    render(<ListSelectionSheet {...defaultProps} />);
    expect(screen.queryByText('Current List')).not.toBeInTheDocument();
  });

  it('shows year-grouped sections', () => {
    render(<ListSelectionSheet {...defaultProps} />);
    expect(screen.getByText('2024')).toBeInTheDocument();
  });

  it('shows target lists', () => {
    render(<ListSelectionSheet {...defaultProps} />);
    expect(screen.getByText('Target List A')).toBeInTheDocument();
  });

  it('calls onSelect and onClose when a list is clicked', () => {
    render(<ListSelectionSheet {...defaultProps} />);
    fireEvent.click(screen.getByText('Target List A'));
    expect(defaultProps.onClose).toHaveBeenCalled();
    expect(defaultProps.onSelect).toHaveBeenCalledWith('list-2');
  });

  it('shows Other section for lists without year', () => {
    render(<ListSelectionSheet {...defaultProps} />);
    expect(screen.getByText('Other')).toBeInTheDocument();
    expect(screen.getByText('No Year List')).toBeInTheDocument();
  });

  it('shows "No other lists available" when only current list exists', () => {
    const singleList = {
      'list-1': mockLists['list-1']!,
    };
    render(<ListSelectionSheet {...defaultProps} lists={singleList} />);
    expect(screen.getByText('No other lists available.')).toBeInTheDocument();
  });
});
