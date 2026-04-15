/**
 * Real-time list synchronization module
 * Handles Socket.io connection and event processing for live updates
 */

import { io } from 'socket.io-client';

/**
 * Create the realtime sync module with dependency injection
 * @param {Object} deps - Dependencies
 * @param {Function} deps.getListData - Get data for a list
 * @param {Function} deps.setListData - Set data for a list
 * @param {Function} deps.getCurrentList - Get the currently selected list ID
 * @param {Function} deps.refreshListData - Refresh list data from server
 * @param {Function} deps.refreshListNav - Refresh the sidebar list navigation
 * @param {Function} deps.showToast - Show toast notification
 * @returns {Object} Realtime sync module with connect/disconnect methods
 */
export function createRealtimeSync(deps = {}) {
  const {
    getCurrentList = () => null,
    getListData = () => null,
    refreshListData = async () => {},
    refreshListDataSilent = refreshListData,
    refreshListNav = () => {},
    showToast = () => {},
    apiCall = async () => {},
    updateAlbumSummaryInPlace = async () => {},
    displayAlbums = () => {},
    ioFactory = io,
    logger = console,
    debug = false,
  } = deps;

  let socket = null;
  let isConnected = false;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 10;

  function logDebug(message, meta) {
    if (!debug || typeof logger.debug !== 'function') return;
    if (meta !== undefined) {
      logger.debug(message, meta);
    } else {
      logger.debug(message);
    }
  }

  function registerSocketEventHandlers() {
    if (!socket) return;
    socket.on('list:updated', handleListUpdated);
    socket.on('list:reordered', handleListReordered);
    socket.on('list:created', handleListCreated);
    socket.on('list:deleted', handleListDeleted);
    socket.on('list:renamed', handleListRenamed);
    socket.on('list:main-changed', handleListMainChanged);
    socket.on('album:summary-updated', handleAlbumSummaryUpdated);
  }

  /**
   * Connect to the WebSocket server
   */
  function connect() {
    if (socket) {
      return; // Already connected or connecting
    }

    // Connect to the same origin (works for both dev and production)
    socket = ioFactory({
      // Use the same path as the HTTP server
      path: '/socket.io',
      // Reconnection settings
      reconnection: true,
      reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      // Use WebSocket first, fallback to polling if needed
      transports: ['websocket', 'polling'],
      // Timeout settings
      timeout: 20000,
    });

    // Connection events
    socket.on('connect', () => {
      isConnected = true;
      reconnectAttempts = 0;
      logDebug('[RealtimeSync] Connected to server', {
        socketId: socket.id,
        transport: socket.io.engine.transport.name,
      });

      // Subscribe to current list if one is selected
      const currentList = getCurrentList();
      if (currentList) {
        subscribeToList(currentList);
      }
    });

    socket.on('disconnect', (reason) => {
      isConnected = false;
      logDebug('[RealtimeSync] Disconnected', { reason });

      if (reason === 'io server disconnect') {
        // Server disconnected us, try to reconnect
        socket.connect();
      }
    });

    socket.on('connect_error', (error) => {
      reconnectAttempts++;
      if (typeof logger.warn === 'function') {
        logger.warn('[RealtimeSync] Connection error', {
          error: error.message,
          reconnectAttempts,
        });
      }

      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        if (typeof logger.error === 'function') {
          logger.error('[RealtimeSync] Max reconnect attempts reached');
        }
      }
    });

    registerSocketEventHandlers();
  }

  /**
   * Disconnect from the WebSocket server
   */
  function disconnect() {
    if (socket) {
      socket.disconnect();
      socket = null;
      isConnected = false;
      logDebug('[RealtimeSync] Disconnected');
    }
  }

  /**
   * Subscribe to updates for a specific list
   * @param {string} listId - ID of the list to subscribe to
   */
  function subscribeToList(listId) {
    if (socket && isConnected) {
      socket.emit('subscribe:list', listId);
      logDebug('[RealtimeSync] Subscribed to list', { listId });
    }
  }

  /**
   * Unsubscribe from updates for a specific list
   * @param {string} listId - ID of the list to unsubscribe from
   */
  function unsubscribeFromList(listId) {
    if (socket && isConnected) {
      socket.emit('unsubscribe:list', listId);
      logDebug('[RealtimeSync] Unsubscribed from list', { listId });
    }
  }

  function getEventListId(data, eventName) {
    if (typeof data?.listId !== 'string' || data.listId.length === 0) {
      if (typeof logger.warn === 'function') {
        logger.warn('[RealtimeSync] Ignoring event without listId', {
          eventName,
          data,
        });
      }
      return null;
    }
    return data.listId;
  }

  /**
   * Handle list updated event
   * @param {Object} data - Event payload
   * @param {string} data.listId - ID of the updated list
   * @param {string} data.updatedAt - Timestamp of the update
   */
  async function handleListUpdated(data) {
    logDebug('[RealtimeSync] List updated', data);

    const listId = getEventListId(data, 'list:updated');
    if (!listId) return;

    const currentList = getCurrentList();
    if (listId === currentList) {
      // Refresh the current list data
      try {
        const result = await refreshListData(listId);
        // Only show notification if this wasn't our own save
        if (!result?.wasLocalSave) {
          showToast('List updated from another device', 'info');
        }
      } catch (error) {
        if (typeof logger.error === 'function') {
          logger.error('[RealtimeSync] Failed to refresh list', {
            listId,
            error,
          });
        }
      }
    } else {
      // For non-current lists, always refresh sidebar
      refreshListNav();
    }
  }

  /**
   * Handle list reordered event
   * @param {Object} data - Event payload
   * @param {string} data.listId - ID of the reordered list
   * @param {Array<string>} data.order - New order of album IDs
   */
  async function handleListReordered(data) {
    logDebug('[RealtimeSync] List reordered', data);

    const listId = getEventListId(data, 'list:reordered');
    if (!listId) return;

    const currentList = getCurrentList();
    if (listId === currentList) {
      // Refresh the current list to get new order
      try {
        await refreshListData(listId);
        // Optionally show notification (can be commented out if too noisy)
        // showToast('List order updated', 'info');
      } catch (error) {
        if (typeof logger.error === 'function') {
          logger.error('[RealtimeSync] Failed to refresh reordered list', {
            listId,
            error,
          });
        }
      }
    }
    // No need to refresh sidebar for reorders (list metadata unchanged)
  }

  /**
   * Handle list created event
   * @param {Object} data - Event payload
   * @param {string} data.listName - Name of the new list
   * @param {number} data.year - Year of the new list
   */
  function handleListCreated(data) {
    logDebug('[RealtimeSync] List created', data);

    const listId = getEventListId(data, 'list:created');
    if (!listId) return;

    // Refresh sidebar to show the new list
    refreshListNav();
    showToast(`New list "${data.listName}" created on another device`, 'info');
  }

  /**
   * Handle list deleted event
   * @param {Object} data - Event payload
   * @param {string} data.listId - ID of the deleted list
   */
  function handleListDeleted(data) {
    logDebug('[RealtimeSync] List deleted', data);

    const listId = getEventListId(data, 'list:deleted');
    if (!listId) return;

    const currentList = getCurrentList();
    if (listId === currentList) {
      // Current list was deleted, show notification
      showToast('Current list was deleted on another device', 'warning');
    }

    // Refresh sidebar to remove the deleted list
    refreshListNav();
  }

  /**
   * Handle list renamed event
   * @param {Object} data - Event payload
   * @param {string} data.listId - ID of the renamed list
   * @param {string} data.oldName - Previous name of the list
   * @param {string} data.newName - New name of the list
   */
  function handleListRenamed(data) {
    logDebug('[RealtimeSync] List renamed', data);

    const listId = getEventListId(data, 'list:renamed');
    if (!listId) return;

    const currentList = getCurrentList();
    if (listId === currentList) {
      showToast(`List renamed to "${data.newName}" on another device`, 'info');
    }

    // Refresh sidebar to show the new name
    refreshListNav();
  }

  /**
   * Handle list main status changed event
   * @param {Object} data - Event payload
   * @param {string} data.listId - ID of the list
   * @param {boolean} data.isMain - Whether the list is now the main list
   */
  function handleListMainChanged(data) {
    logDebug('[RealtimeSync] List main status changed', data);

    const listId = getEventListId(data, 'list:main-changed');
    if (!listId) return;

    // Refresh sidebar to update the main indicator
    refreshListNav();

    // If this is the currently displayed list, re-render to show/hide position numbers
    // Position numbers only appear on main lists (they have semantic meaning for rankings)
    const currentList = getCurrentList();
    if (listId === currentList) {
      const albums = getListData(currentList);
      if (albums) {
        // Force full rebuild to add/remove position elements
        displayAlbums(albums, { forceFullRebuild: true });
      }
    }
  }

  /**
   * Handle album summary updated event
   * @param {Object} data - Event payload
   * @param {string} data.albumId - Album ID that was updated
   */
  async function handleAlbumSummaryUpdated(data) {
    logDebug('[RealtimeSync] Album summary updated', data);

    const currentList = getCurrentList();
    if (!currentList) {
      logDebug('[RealtimeSync] No current list, skipping summary update');
      return;
    }

    // Try incremental update first
    const albums = getListData(currentList);
    const albumIndex =
      albums?.findIndex((a) => a.album_id === data.albumId) ?? -1;

    if (albumIndex >= 0 && updateAlbumSummaryInPlace && apiCall) {
      try {
        // Fetch only the updated summary
        const summaryData = await apiCall(
          `/api/albums/${data.albumId}/summary`
        );

        // Update in-place without full refresh
        await updateAlbumSummaryInPlace(data.albumId, summaryData);
        logDebug('[RealtimeSync] Summary updated incrementally', {
          albumId: data.albumId,
          hasSummary: !!summaryData.summary,
          source: summaryData.summarySource || 'unknown',
        });
        return;
      } catch (err) {
        if (typeof logger.warn === 'function') {
          logger.warn(
            '[RealtimeSync] Incremental update failed, falling back to full refresh',
            {
              albumId: data.albumId,
              error: err,
            }
          );
        }
        // Fall back to full refresh on error
      }
    }

    // Fallback to full refresh
    // This ensures the summary badge appears even if:
    // - The album was just added and local state is stale
    // - The album check fails due to timing issues
    // - The list data hasn't been synced yet
    logDebug('[RealtimeSync] Refreshing list to show summary badge', {
      currentList,
      albumId: data.albumId,
    });

    try {
      await refreshListDataSilent(currentList);
      logDebug('[RealtimeSync] List refreshed after summary update');
    } catch (error) {
      if (typeof logger.error === 'function') {
        logger.error(
          '[RealtimeSync] Failed to refresh list after summary update',
          {
            currentList,
            albumId: data.albumId,
            error,
          }
        );
      }
    }
  }

  /**
   * Check if currently connected
   * @returns {boolean} Connection status
   */
  function getIsConnected() {
    return isConnected;
  }

  /**
   * Get the socket instance (for advanced usage)
   * @returns {Object|null} Socket.io socket instance
   */
  function getSocket() {
    return socket;
  }

  return {
    connect,
    disconnect,
    subscribeToList,
    unsubscribeFromList,
    getIsConnected,
    getSocket,
  };
}
