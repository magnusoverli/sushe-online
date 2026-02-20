import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

// --- Mock socket.io-client ---

type EventHandler = (...args: unknown[]) => void;

const mockSocket = {
  id: 'mock-socket-id',
  connected: true,
  on: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
};

const mockIo = vi.fn(() => mockSocket);

vi.mock('socket.io-client', () => ({
  io: (...args: Parameters<typeof mockIo>) => mockIo(...args),
}));

// --- Mock api-client ---

const mockSetSocketId = vi.fn();

vi.mock('@/services/api-client', () => ({
  setSocketId: (...args: unknown[]) => mockSetSocketId(...args),
}));

// --- Mock app-store ---

let storeState = {
  isAuthenticated: true,
  activeListId: 'list-1' as string | null,
  setActiveListId: vi.fn(),
};

vi.mock('@/stores/app-store', () => ({
  useAppStore: (selector: (s: typeof storeState) => unknown) =>
    selector(storeState),
}));

// --- Import after mocks ---

import { useRealtimeSync } from '../useRealtimeSync';

// --- Helpers ---

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

/** Extract a registered event handler by name from mockSocket.on calls. */
function getHandler(event: string): EventHandler {
  const call = mockSocket.on.mock.calls.find((c: unknown[]) => c[0] === event);
  if (!call) throw new Error(`No handler registered for "${event}"`);
  return call[1] as EventHandler;
}

describe('useRealtimeSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket.connected = true;
    mockSocket.id = 'mock-socket-id';
    storeState = {
      isAuthenticated: true,
      activeListId: 'list-1',
      setActiveListId: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('connects to Socket.IO when authenticated', () => {
    renderHook(() => useRealtimeSync(), { wrapper: createWrapper() });

    expect(mockIo).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/socket.io',
        reconnection: true,
        transports: ['websocket', 'polling'],
      })
    );
  });

  it('does not connect when not authenticated', () => {
    storeState.isAuthenticated = false;

    renderHook(() => useRealtimeSync(), { wrapper: createWrapper() });

    expect(mockIo).not.toHaveBeenCalled();
  });

  it('sets socket ID on connect', () => {
    renderHook(() => useRealtimeSync(), { wrapper: createWrapper() });

    const connectHandler = getHandler('connect');
    act(() => connectHandler());

    expect(mockSetSocketId).toHaveBeenCalledWith('mock-socket-id');
  });

  it('clears socket ID on disconnect', () => {
    renderHook(() => useRealtimeSync(), { wrapper: createWrapper() });

    const disconnectHandler = getHandler('disconnect');
    act(() => disconnectHandler());

    expect(mockSetSocketId).toHaveBeenCalledWith(null);
  });

  it('subscribes to the active list on connect', () => {
    renderHook(() => useRealtimeSync(), { wrapper: createWrapper() });

    const connectHandler = getHandler('connect');
    act(() => connectHandler());

    expect(mockSocket.emit).toHaveBeenCalledWith('subscribe:list', 'list-1');
  });

  it('registers all expected event handlers', () => {
    renderHook(() => useRealtimeSync(), { wrapper: createWrapper() });

    const registeredEvents = mockSocket.on.mock.calls.map(
      (c: unknown[]) => c[0]
    );

    expect(registeredEvents).toContain('connect');
    expect(registeredEvents).toContain('disconnect');
    expect(registeredEvents).toContain('list:updated');
    expect(registeredEvents).toContain('list:reordered');
    expect(registeredEvents).toContain('list:created');
    expect(registeredEvents).toContain('list:deleted');
    expect(registeredEvents).toContain('list:renamed');
    expect(registeredEvents).toContain('list:main-changed');
    expect(registeredEvents).toContain('album:summary-updated');
  });

  it('disconnects on unmount', () => {
    const { unmount } = renderHook(() => useRealtimeSync(), {
      wrapper: createWrapper(),
    });

    unmount();

    expect(mockSocket.disconnect).toHaveBeenCalled();
    expect(mockSetSocketId).toHaveBeenCalledWith(null);
  });

  it('disconnects when auth state changes to unauthenticated', () => {
    const { rerender } = renderHook(() => useRealtimeSync(), {
      wrapper: createWrapper(),
    });

    // Simulate losing auth
    storeState.isAuthenticated = false;
    rerender();

    expect(mockSocket.disconnect).toHaveBeenCalled();
  });

  describe('event → query invalidation', () => {
    let queryClient: QueryClient;

    function createWrapperWithClient() {
      queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children);

      return { wrapper, invalidateSpy };
    }

    it('list:updated invalidates album query', () => {
      const { wrapper, invalidateSpy } = createWrapperWithClient();
      renderHook(() => useRealtimeSync(), { wrapper });

      const handler = getHandler('list:updated');
      act(() => handler({ listId: 'list-42' }));

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['lists', 'list-42', 'albums'],
      });
    });

    it('list:reordered invalidates album query', () => {
      const { wrapper, invalidateSpy } = createWrapperWithClient();
      renderHook(() => useRealtimeSync(), { wrapper });

      const handler = getHandler('list:reordered');
      act(() => handler({ listId: 'list-42' }));

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['lists', 'list-42', 'albums'],
      });
    });

    it('list:created invalidates metadata and groups', () => {
      const { wrapper, invalidateSpy } = createWrapperWithClient();
      renderHook(() => useRealtimeSync(), { wrapper });

      const handler = getHandler('list:created');
      act(() => handler({ listId: 'new-list' }));

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['lists', 'metadata'],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['groups'],
      });
    });

    it('list:deleted invalidates metadata and groups', () => {
      const { wrapper, invalidateSpy } = createWrapperWithClient();
      renderHook(() => useRealtimeSync(), { wrapper });

      const handler = getHandler('list:deleted');
      act(() => handler({ listId: 'other-list' }));

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['lists', 'metadata'],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['groups'],
      });
    });

    it('list:deleted clears activeListId when active list is deleted', () => {
      const { wrapper } = createWrapperWithClient();
      renderHook(() => useRealtimeSync(), { wrapper });

      const handler = getHandler('list:deleted');
      act(() => handler({ listId: 'list-1' }));

      expect(storeState.setActiveListId).toHaveBeenCalledWith(null);
    });

    it('list:deleted does NOT clear activeListId for a different list', () => {
      const { wrapper } = createWrapperWithClient();
      renderHook(() => useRealtimeSync(), { wrapper });

      const handler = getHandler('list:deleted');
      act(() => handler({ listId: 'other-list' }));

      expect(storeState.setActiveListId).not.toHaveBeenCalled();
    });

    it('list:renamed invalidates metadata', () => {
      const { wrapper, invalidateSpy } = createWrapperWithClient();
      renderHook(() => useRealtimeSync(), { wrapper });

      const handler = getHandler('list:renamed');
      act(() => handler({ listId: 'list-1' }));

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['lists', 'metadata'],
      });
    });

    it('list:main-changed invalidates metadata', () => {
      const { wrapper, invalidateSpy } = createWrapperWithClient();
      renderHook(() => useRealtimeSync(), { wrapper });

      const handler = getHandler('list:main-changed');
      act(() => handler({ listId: 'list-1' }));

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['lists', 'metadata'],
      });
    });

    it('album:summary-updated invalidates active list albums', () => {
      const { wrapper, invalidateSpy } = createWrapperWithClient();
      renderHook(() => useRealtimeSync(), { wrapper });

      const handler = getHandler('album:summary-updated');
      act(() => handler({ albumId: 'album-99' }));

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['lists', 'list-1', 'albums'],
      });
    });

    it('album:summary-updated does nothing when no active list', () => {
      storeState.activeListId = null;
      const { wrapper, invalidateSpy } = createWrapperWithClient();
      renderHook(() => useRealtimeSync(), { wrapper });

      const handler = getHandler('album:summary-updated');
      act(() => handler({ albumId: 'album-99' }));

      // Should not have been called with an albums key
      const albumCalls = invalidateSpy.mock.calls.filter(
        (c) =>
          Array.isArray((c[0] as { queryKey: unknown[] }).queryKey) &&
          (c[0] as { queryKey: unknown[] }).queryKey.includes('albums')
      );
      expect(albumCalls).toHaveLength(0);
    });
  });
});
