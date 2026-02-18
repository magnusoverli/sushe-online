import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettingsDrawer } from '../SettingsDrawer';
import { useAppStore } from '@/stores/app-store';

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      style,
      ...props
    }: {
      children: React.ReactNode;
      style?: React.CSSProperties;
      [key: string]: unknown;
    }) => (
      <div style={style} {...props}>
        {children}
      </div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={createQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

describe('SettingsDrawer', () => {
  beforeEach(() => {
    useAppStore.setState({
      user: {
        _id: 'u1',
        email: 'test@example.com',
        username: 'testuser',
        role: 'user',
        spotifyConnected: true,
        tidalConnected: false,
        lastfmConnected: false,
        accentColor: '#dc2626',
        timeFormat: '24h',
        dateFormat: 'MM/DD/YYYY',
        musicService: 'spotify',
        createdAt: '2024-01-01T00:00:00Z',
      },
      isAuthenticated: true,
      listsMetadata: {},
    });
  });

  it('should not render when closed', () => {
    render(
      <Wrapper>
        <SettingsDrawer open={false} onClose={vi.fn()} />
      </Wrapper>
    );
    expect(screen.queryByTestId('settings-drawer')).not.toBeInTheDocument();
  });

  it('should render when open', () => {
    render(
      <Wrapper>
        <SettingsDrawer open={true} onClose={vi.fn()} />
      </Wrapper>
    );
    expect(screen.getByTestId('settings-drawer')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('should show all non-admin tabs for regular user', () => {
    render(
      <Wrapper>
        <SettingsDrawer open={true} onClose={vi.fn()} />
      </Wrapper>
    );
    expect(screen.getByTestId('settings-tab-account')).toBeInTheDocument();
    expect(screen.getByTestId('settings-tab-integrations')).toBeInTheDocument();
    expect(screen.getByTestId('settings-tab-visual')).toBeInTheDocument();
    expect(screen.getByTestId('settings-tab-stats')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-tab-admin')).not.toBeInTheDocument();
  });

  it('should show admin tab for admin users', () => {
    useAppStore.setState({
      user: {
        _id: 'u1',
        email: 'admin@example.com',
        username: 'admin',
        role: 'admin',
        createdAt: '2024-01-01T00:00:00Z',
      },
    });
    render(
      <Wrapper>
        <SettingsDrawer open={true} onClose={vi.fn()} />
      </Wrapper>
    );
    expect(screen.getByTestId('settings-tab-admin')).toBeInTheDocument();
  });

  it('should close when Done button is clicked', () => {
    const onClose = vi.fn();
    render(
      <Wrapper>
        <SettingsDrawer open={true} onClose={onClose} />
      </Wrapper>
    );
    fireEvent.click(screen.getByTestId('settings-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should switch tabs when tab buttons are clicked', () => {
    render(
      <Wrapper>
        <SettingsDrawer open={true} onClose={vi.fn()} />
      </Wrapper>
    );

    // Start on Account tab - should show email
    expect(screen.getByText('test@example.com')).toBeInTheDocument();

    // Switch to Visual tab
    fireEvent.click(screen.getByTestId('settings-tab-visual'));
    expect(screen.getByText('Accent Color')).toBeInTheDocument();
  });

  it('should show user profile info on Account tab', () => {
    render(
      <Wrapper>
        <SettingsDrawer open={true} onClose={vi.fn()} />
      </Wrapper>
    );
    expect(screen.getByText('test@example.com')).toBeInTheDocument();
    expect(screen.getByText('testuser')).toBeInTheDocument();
    expect(screen.getByText('User')).toBeInTheDocument();
  });

  it('should show Spotify connected on Integrations tab', () => {
    render(
      <Wrapper>
        <SettingsDrawer open={true} onClose={vi.fn()} />
      </Wrapper>
    );
    fireEvent.click(screen.getByTestId('settings-tab-integrations'));
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });
});
