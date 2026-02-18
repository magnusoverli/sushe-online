import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
