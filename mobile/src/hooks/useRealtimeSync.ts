/**
 * useRealtimeSync - Socket.IO realtime sync hook.
 *
 * Connects to the server's Socket.IO endpoint, subscribes to the active list,
 * and invalidates React Query caches when server-side events arrive.
 * Also exposes the socket ID so the API client can send X-Socket-ID on
 * mutations (preventing echo updates from the server).
 */

import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '@/stores/app-store';
import { setSocketId } from '@/services/api-client';

/** Event payloads emitted by the server. */
interface ListEvent {
  listId: string;
}

interface AlbumSummaryEvent {
  albumId: string;
}

export function useRealtimeSync() {
  const queryClient = useQueryClient();
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const activeListId = useAppStore((s) => s.activeListId);
  const setActiveListId = useAppStore((s) => s.setActiveListId);

  // Keep a stable ref to the active list ID so event handlers always see the
  // latest value without needing to re-register listeners.
  const activeListIdRef = useRef(activeListId);
  activeListIdRef.current = activeListId;

  const setActiveListIdRef = useRef(setActiveListId);
  setActiveListIdRef.current = setActiveListId;

  const socketRef = useRef<Socket | null>(null);

  // --- Connect / disconnect based on auth state ---
  useEffect(() => {
    if (!isAuthenticated) {
      // Not logged in — tear down any existing connection
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocketId(null);
      }
      return;
    }

    const socket = io({
      path: '/socket.io',
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      transports: ['websocket', 'polling'],
      timeout: 20000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketId(socket.id ?? null);

      // Re-subscribe to the active list on (re)connect
      const listId = activeListIdRef.current;
      if (listId) {
        socket.emit('subscribe:list', listId);
      }
    });

    socket.on('disconnect', () => {
      setSocketId(null);
    });

    // --- Event handlers ---

    socket.on('list:updated', (data: ListEvent) => {
      queryClient.invalidateQueries({
        queryKey: ['lists', data.listId, 'albums'],
      });
    });

    socket.on('list:reordered', (data: ListEvent) => {
      queryClient.invalidateQueries({
        queryKey: ['lists', data.listId, 'albums'],
      });
    });

    socket.on('list:created', () => {
      queryClient.invalidateQueries({ queryKey: ['lists', 'metadata'] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    });

    socket.on('list:deleted', (data: ListEvent) => {
      queryClient.invalidateQueries({ queryKey: ['lists', 'metadata'] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });

      // If the deleted list is the one we're viewing, clear it
      if (data.listId === activeListIdRef.current) {
        setActiveListIdRef.current(null);
      }
    });

    socket.on('list:renamed', () => {
      queryClient.invalidateQueries({ queryKey: ['lists', 'metadata'] });
    });

    socket.on('list:main-changed', () => {
      queryClient.invalidateQueries({ queryKey: ['lists', 'metadata'] });
    });

    socket.on('album:summary-updated', (_data: AlbumSummaryEvent) => {
      const listId = activeListIdRef.current;
      if (listId) {
        queryClient.invalidateQueries({
          queryKey: ['lists', listId, 'albums'],
        });
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setSocketId(null);
    };
    // queryClient is stable across renders; isAuthenticated drives reconnect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // --- Subscribe / unsubscribe when the active list changes ---
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket?.connected || !activeListId) return;

    socket.emit('subscribe:list', activeListId);

    return () => {
      socket.emit('unsubscribe:list', activeListId);
    };
  }, [activeListId]);
}
