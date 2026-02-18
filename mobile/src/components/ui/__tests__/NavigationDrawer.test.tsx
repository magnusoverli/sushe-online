import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NavigationDrawer, DrawerNavItem } from '../NavigationDrawer';

describe('NavigationDrawer', () => {
  it('renders when open is true', () => {
    render(
      <NavigationDrawer open={true} onClose={vi.fn()}>
        <div>Drawer content</div>
      </NavigationDrawer>
    );
    expect(screen.getByTestId('navigation-drawer')).toBeInTheDocument();
    expect(screen.getByText('Drawer content')).toBeInTheDocument();
  });

  it('does not render when open is false', () => {
    render(
      <NavigationDrawer open={false} onClose={vi.fn()}>
        <div>Drawer content</div>
      </NavigationDrawer>
    );
    expect(screen.queryByTestId('navigation-drawer')).not.toBeInTheDocument();
  });

  it('renders header when provided', () => {
    render(
      <NavigationDrawer
        open={true}
        onClose={vi.fn()}
        header={<div>My Collection</div>}
      >
        <div>Lists</div>
      </NavigationDrawer>
    );
    expect(screen.getByText('My Collection')).toBeInTheDocument();
  });

  it('renders scrim when open', () => {
    render(
      <NavigationDrawer open={true} onClose={vi.fn()}>
        <div>content</div>
      </NavigationDrawer>
    );
    expect(screen.getByTestId('scrim')).toBeInTheDocument();
  });

  it('has navigation role', () => {
    render(
      <NavigationDrawer open={true} onClose={vi.fn()}>
        <div>content</div>
      </NavigationDrawer>
    );
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });
});

describe('DrawerNavItem', () => {
  it('renders label', () => {
    render(<DrawerNavItem label="All Albums" />);
    expect(screen.getByText('All Albums')).toBeInTheDocument();
  });

  it('renders count badge when provided', () => {
    render(<DrawerNavItem label="Favourites" count={12} />);
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('does not render count when not provided', () => {
    render(<DrawerNavItem label="Settings" />);
    // Only the label text should exist
    expect(screen.getByTestId('drawer-nav-item').childElementCount).toBe(1);
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<DrawerNavItem label="Test" onClick={onClick} />);
    fireEvent.click(screen.getByTestId('drawer-nav-item'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('applies active styling background', () => {
    render(<DrawerNavItem label="Active List" isActive />);
    const item = screen.getByTestId('drawer-nav-item');
    expect(item.style.background).toBe('rgba(232, 200, 122, 0.08)');
  });

  it('renders drag handle when showDragHandle is true', () => {
    render(<DrawerNavItem label="Draggable" showDragHandle />);
    expect(screen.getByTestId('drawer-drag-handle')).toBeInTheDocument();
  });

  it('does not render drag handle by default', () => {
    render(<DrawerNavItem label="Static" />);
    expect(screen.queryByTestId('drawer-drag-handle')).not.toBeInTheDocument();
  });

  it('applies dragging style when dragState is dragging', () => {
    render(<DrawerNavItem label="Dragging" dragState="dragging" />);
    const item = screen.getByTestId('drawer-nav-item');
    expect(item.style.opacity).toBe('0.6');
    expect(item.style.background).toBe('rgba(232, 200, 122, 0.15)');
  });

  it('applies drop-target style when dragState is drop-target', () => {
    render(<DrawerNavItem label="Target" dragState="drop-target" />);
    const item = screen.getByTestId('drawer-nav-item');
    expect(item.style.background).toBe('rgba(232, 200, 122, 0.06)');
  });
});
