import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Dropdown, type DropdownItem } from '../Dropdown';

const items: DropdownItem[] = [
  { id: 'year', label: 'Year' },
  { id: 'artist', label: 'Artist' },
  { id: 'genre', label: 'Genre' },
  { id: 'title', label: 'Title (A-Z)' },
  { id: 'custom', label: 'Custom' },
];

describe('Dropdown', () => {
  it('renders when open is true', () => {
    render(
      <Dropdown
        open={true}
        onClose={vi.fn()}
        items={items}
        selectedId="year"
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByTestId('dropdown')).toBeInTheDocument();
  });

  it('does not render when open is false', () => {
    render(
      <Dropdown
        open={false}
        onClose={vi.fn()}
        items={items}
        selectedId="year"
        onSelect={vi.fn()}
      />
    );
    expect(screen.queryByTestId('dropdown')).not.toBeInTheDocument();
  });

  it('renders all items', () => {
    render(
      <Dropdown
        open={true}
        onClose={vi.fn()}
        items={items}
        selectedId="year"
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText('Year')).toBeInTheDocument();
    expect(screen.getByText('Artist')).toBeInTheDocument();
    expect(screen.getByText('Genre')).toBeInTheDocument();
    expect(screen.getByText('Custom')).toBeInTheDocument();
  });

  it('marks selected item with aria-selected', () => {
    render(
      <Dropdown
        open={true}
        onClose={vi.fn()}
        items={items}
        selectedId="genre"
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByTestId('dropdown-item-genre')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByTestId('dropdown-item-year')).toHaveAttribute(
      'aria-selected',
      'false'
    );
  });

  it('calls onSelect and onClose when item clicked', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <Dropdown
        open={true}
        onClose={onClose}
        items={items}
        selectedId="year"
        onSelect={onSelect}
      />
    );
    fireEvent.click(screen.getByTestId('dropdown-item-artist'));
    expect(onSelect).toHaveBeenCalledWith('artist');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders section label when provided', () => {
    render(
      <Dropdown
        open={true}
        onClose={vi.fn()}
        items={items}
        selectedId="year"
        onSelect={vi.fn()}
        sectionLabel="SORT BY"
      />
    );
    expect(screen.getByText('SORT BY')).toBeInTheDocument();
  });

  it('has listbox role', () => {
    render(
      <Dropdown
        open={true}
        onClose={vi.fn()}
        items={items}
        selectedId="year"
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });
});
