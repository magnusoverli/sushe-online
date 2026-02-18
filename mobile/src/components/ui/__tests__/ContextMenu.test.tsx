import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContextMenu, type ContextMenuItem } from '../ContextMenu';

const MockIcon = () => <span>ic</span>;

const items: ContextMenuItem[] = [
  { id: 'edit', icon: <MockIcon />, label: 'Edit Album' },
  { id: 'add', icon: <MockIcon />, label: 'Add to List...' },
  {
    id: 'delete',
    icon: <MockIcon />,
    label: 'Delete Album',
    destructive: true,
    dividerBefore: true,
  },
];

describe('ContextMenu', () => {
  it('renders when open is true', () => {
    render(<ContextMenu open={true} onClose={vi.fn()} items={items} />);
    expect(screen.getByTestId('context-menu')).toBeInTheDocument();
  });

  it('does not render when open is false', () => {
    render(<ContextMenu open={false} onClose={vi.fn()} items={items} />);
    expect(screen.queryByTestId('context-menu')).not.toBeInTheDocument();
  });

  it('renders all menu items', () => {
    render(<ContextMenu open={true} onClose={vi.fn()} items={items} />);
    expect(screen.getByText('Edit Album')).toBeInTheDocument();
    expect(screen.getByText('Add to List...')).toBeInTheDocument();
    expect(screen.getByText('Delete Album')).toBeInTheDocument();
  });

  it('renders context header when provided', () => {
    render(
      <ContextMenu
        open={true}
        onClose={vi.fn()}
        items={items}
        header={{
          title: 'Rumours',
          artist: 'Fleetwood Mac',
        }}
      />
    );
    expect(screen.getByText('Rumours')).toBeInTheDocument();
    expect(screen.getByText('Fleetwood Mac')).toBeInTheDocument();
  });

  it('calls item onClick and onClose when clicked', () => {
    const onClose = vi.fn();
    const editClick = vi.fn();
    const testItems: ContextMenuItem[] = [
      { id: 'edit', icon: <MockIcon />, label: 'Edit', onClick: editClick },
    ];
    render(<ContextMenu open={true} onClose={onClose} items={testItems} />);
    fireEvent.click(screen.getByTestId('context-menu-item-edit'));
    expect(editClick).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on Escape key', () => {
    const onClose = vi.fn();
    render(<ContextMenu open={true} onClose={onClose} items={items} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('has menu role', () => {
    render(<ContextMenu open={true} onClose={vi.fn()} items={items} />);
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('renders menu items with menuitem role', () => {
    render(<ContextMenu open={true} onClose={vi.fn()} items={items} />);
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
  });
});
