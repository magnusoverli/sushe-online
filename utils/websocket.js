/**
 * WebSocket service for real-time list synchronization
 * Uses Socket.io for bidirectional communication between clients
 */

const { Server } = require('socket.io');
const {
  incWebsocketConnections,
  decWebsocketConnections,
} = require('./metrics');
const {
  isAllowedOrigin,
  createOriginPolicyFromEnv,
} = require('./origin-policy');

/**
 * Create broadcast helpers that emit to a user's room
 * @param {Function} getIO - () => io (Socket.io server)
 * @param {Object} logger - Logger instance
 * @returns {Object} Broadcast methods
 */
function createBroadcast(getIO, logger) {
  function emitToUser(event, warnMsg, userId, payload, options = {}) {
    const io = getIO();
    if (!io) {
      logger.warn(warnMsg);
      return;
    }
    const userRoom = `user:${userId}`;
    if (options.excludeSocketId) {
      io.to(userRoom).except(options.excludeSocketId).emit(event, payload);
    } else {
      io.to(userRoom).emit(event, payload);
    }
  }

  return {
    // NOTE: Events now use listId instead of listName to support duplicate names
    listUpdated(userId, listId, options = {}) {
      emitToUser(
        'list:updated',
        'WebSocket not initialized, cannot broadcast list:updated',
        userId,
        { listId, updatedAt: new Date().toISOString() },
        options
      );
      logger.debug('Broadcast list:updated', { userId, listId });
    },
    listCreated(userId, listId, listName, year) {
      emitToUser(
        'list:created',
        'WebSocket not initialized, cannot broadcast list:created',
        userId,
        { listId, listName, year, createdAt: new Date().toISOString() }
      );
      logger.debug('Broadcast list:created', {
        userId,
        listId,
        listName,
        year,
      });
    },
    listDeleted(userId, listId) {
      emitToUser(
        'list:deleted',
        'WebSocket not initialized, cannot broadcast list:deleted',
        userId,
        { listId, deletedAt: new Date().toISOString() }
      );
      logger.debug('Broadcast list:deleted', { userId, listId });
    },
    listRenamed(userId, listId, oldName, newName) {
      emitToUser(
        'list:renamed',
        'WebSocket not initialized, cannot broadcast list:renamed',
        userId,
        { listId, oldName, newName, renamedAt: new Date().toISOString() }
      );
      logger.debug('Broadcast list:renamed', {
        userId,
        listId,
        oldName,
        newName,
      });
    },
    listMainChanged(userId, listId, isMain) {
      emitToUser(
        'list:main-changed',
        'WebSocket not initialized, cannot broadcast list:main-changed',
        userId,
        { listId, isMain, changedAt: new Date().toISOString() }
      );
      logger.debug('Broadcast list:main-changed', { userId, listId, isMain });
    },
    listReordered(userId, listId, order, options = {}) {
      emitToUser(
        'list:reordered',
        'WebSocket not initialized, cannot broadcast list:reordered',
        userId,
        { listId, order, reorderedAt: new Date().toISOString() },
        options
      );
      logger.debug('Broadcast list:reordered', { userId, listId });
    },
    albumSummaryUpdated(userId, albumId) {
      const io = getIO();
      if (!io) {
        logger.warn(
          'WebSocket not initialized, cannot broadcast album:summary-updated',
          { userId, albumId }
        );
        return;
      }
      const userRoom = `user:${userId}`;
      const payload = {
        albumId,
        updatedAt: new Date().toISOString(),
      };
      const room = io.sockets.adapter.rooms.get(userRoom);
      const clientCount = room ? room.size : 0;
      io.to(userRoom).emit('album:summary-updated', payload);
      logger.info('Broadcast album:summary-updated', {
        userId,
        albumId,
        clientCount,
        userRoom,
      });
    },
  };
}

/**
 * Create the WebSocket service with dependency injection
 * @param {Object} deps - Dependencies
 * @param {Object} deps.logger - Logger instance
 * @returns {Object} WebSocket service with setup and broadcast methods
 */
function createWebSocketService(deps = {}) {
  const logger = deps.logger || require('./logger');

  let io = null;

  /**
   * Set up Socket.io server with the HTTP server
   * @param {Object} httpServer - Node.js HTTP server instance
   * @param {Object} sessionMiddleware - Express session middleware
   * @returns {Object} Socket.io server instance
   */
  function setup(httpServer, sessionMiddleware) {
    const originPolicy = createOriginPolicyFromEnv(process.env);

    io = new Server(httpServer, {
      cors: {
        origin: function (origin, callback) {
          if (isAllowedOrigin(origin, originPolicy)) {
            return callback(null, true);
          }

          callback(new Error('Not allowed by CORS'));
        },
        credentials: true,
      },
      // Connection settings
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    // Share session with Socket.io
    io.engine.use(sessionMiddleware);

    // Handle new connections
    io.on('connection', (socket) => {
      const session = socket.request.session;
      const userId = session?.passport?.user;

      if (!userId) {
        logger.debug('WebSocket connection rejected: no authenticated user');
        socket.disconnect(true);
        return;
      }

      // Join user-specific room for targeted broadcasts
      const userRoom = `user:${userId}`;
      socket.join(userRoom);

      // Track connection metrics
      incWebsocketConnections();

      logger.info('WebSocket client connected', {
        socketId: socket.id,
        userId,
        userRoom,
      });

      // Handle client subscribing to a specific list
      socket.on('subscribe:list', (listId) => {
        if (typeof listId !== 'string' || listId.length === 0) {
          logger.warn('Client subscribe:list payload missing listId', {
            socketId: socket.id,
            userId,
            listId,
          });
          return;
        }

        const listRoom = `list:${userId}:${listId}`;
        socket.join(listRoom);
        logger.debug('Client subscribed to list', {
          socketId: socket.id,
          listId,
          listRoom,
        });
      });

      // Handle client unsubscribing from a list
      socket.on('unsubscribe:list', (listId) => {
        if (typeof listId !== 'string' || listId.length === 0) {
          logger.warn('Client unsubscribe:list payload missing listId', {
            socketId: socket.id,
            userId,
            listId,
          });
          return;
        }

        const listRoom = `list:${userId}:${listId}`;
        socket.leave(listRoom);
        logger.debug('Client unsubscribed from list', {
          socketId: socket.id,
          listId,
        });
      });

      // Handle disconnection
      socket.on('disconnect', (reason) => {
        // Track connection metrics
        decWebsocketConnections();

        logger.info('WebSocket client disconnected', {
          socketId: socket.id,
          userId,
          reason,
        });
      });

      // Handle errors
      socket.on('error', (error) => {
        logger.error('WebSocket error', {
          socketId: socket.id,
          userId,
          error: error.message,
        });
      });
    });

    logger.info('WebSocket server initialized');
    return io;
  }

  const broadcast = createBroadcast(() => io, logger);

  /**
   * Get the Socket.io server instance
   * @returns {Object|null} Socket.io server instance or null if not initialized
   */
  function getIO() {
    return io;
  }

  /**
   * Shutdown the WebSocket server
   */
  function shutdown() {
    if (io) {
      io.close();
      logger.info('WebSocket server shut down');
    }
  }

  return {
    setup,
    broadcast,
    getIO,
    shutdown,
  };
}

// Create default instance
const defaultInstance = createWebSocketService();

module.exports = {
  createWebSocketService,
  ...defaultInstance,
};
