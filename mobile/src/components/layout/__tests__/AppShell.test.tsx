import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppShell } from '../AppShell';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

describe('AppShell', () => {
  it('renders children and TabBar', () => {
    render(
      <AppShell activeTab="library">
        <div data-testid="child-content">Hello</div>
      </AppShell>
    );

    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    expect(screen.getByTestId('app-shell-content')).toBeInTheDocument();
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
    expect(screen.getByTestId('tab-bar')).toBeInTheDocument();
  });

  it('passes activeTab to TabBar', () => {
    render(
      <AppShell activeTab="search">
        <div>Content</div>
      </AppShell>
    );

    const searchTab = screen.getByTestId('tab-search');
    expect(searchTab).toHaveAttribute('aria-selected', 'true');
  });

  it('main content area is scrollable', () => {
    render(
      <AppShell activeTab="library">
        <div>Content</div>
      </AppShell>
    );

    const content = screen.getByTestId('app-shell-content');
    expect(content.tagName).toBe('MAIN');
  });

  it('renders header slot above main when provided', () => {
    render(
      <AppShell
        activeTab="library"
        header={<div data-testid="custom-header">Header</div>}
      >
        <div data-testid="child-content">Body</div>
      </AppShell>
    );

    const headerWrapper = screen.getByTestId('app-shell-header');
    expect(headerWrapper).toBeInTheDocument();
    expect(screen.getByTestId('custom-header')).toBeInTheDocument();

    // Header should come before main in DOM order
    const shell = screen.getByTestId('app-shell');
    const children = Array.from(shell.children);
    const headerIdx = children.indexOf(headerWrapper);
    const mainIdx = children.indexOf(screen.getByTestId('app-shell-content'));
    expect(headerIdx).toBeLessThan(mainIdx);
  });

  it('does not render header wrapper when header is not provided', () => {
    render(
      <AppShell activeTab="library">
        <div>Content</div>
      </AppShell>
    );

    expect(screen.queryByTestId('app-shell-header')).not.toBeInTheDocument();
  });

  it('passes onSettingsClick to TabBar', () => {
    const onSettingsClick = vi.fn();
    render(
      <AppShell activeTab="library" onSettingsClick={onSettingsClick}>
        <div>Content</div>
      </AppShell>
    );

    fireEvent.click(screen.getByTestId('tab-settings'));
    expect(onSettingsClick).toHaveBeenCalledTimes(1);
  });
});
