/**
 * WebSocket service for real-time list synchronization
 * Uses Socket.io for bidirectional communication between clients
 */

const { Server } = require('socket.io');
const {
  incWebsocketConnections,
  decWebsocketConnections,
} = require('./metrics');

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
    io = new Server(httpServer, {
      cors: {
        origin: function (origin, callback) {
          // Allow requests with no origin (like mobile apps, curl, Postman)
          if (!origin) return callback(null, true);

          // Allow chrome-extension:// origins (browser extensions)
          if (origin.startsWith('chrome-extension://')) {
            return callback(null, true);
          }

          // Allow moz-extension:// origins (Firefox extensions)
          if (origin.startsWith('moz-extension://')) {
            return callback(null, true);
          }

          // Allow localhost for development
          if (
            origin.includes('localhost') ||
            origin.includes('127.0.0.1') ||
            origin.includes('[::1]')
          ) {
            return callback(null, true);
          }

          // Allow private network IP addresses (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
          // Also allow CGNAT range (100.64-127.x.x) used by Tailscale and other VPNs
          const ipMatch = origin.match(
            // eslint-disable-next-line security/detect-unsafe-regex
            /^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3}|100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\.\d{1,3}\.\d{1,3})(:\d+)?$/
          );
          if (ipMatch) {
            return callback(null, true);
          }

          // Allow all HTTPS origins
          if (origin.startsWith('https://')) {
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
      socket.on('subscribe:list', (listName) => {
        const listRoom = `list:${userId}:${listName}`;
        socket.join(listRoom);
        logger.debug('Client subscribed to list', {
          socketId: socket.id,
          listName,
          listRoom,
        });
      });

      // Handle client unsubscribing from a list
      socket.on('unsubscribe:list', (listName) => {
        const listRoom = `list:${userId}:${listName}`;
        socket.leave(listRoom);
        logger.debug('Client unsubscribed from list', {
          socketId: socket.id,
          listName,
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

  /**
   * Broadcast service for emitting events to connected clients
   */
  const broadcast = {
    /**
     * Notify all clients of a user that a list was updated
     * @param {string} userId - User ID
     * @param {string} listName - Name of the updated list
     * @param {Object} options - Additional options
     * @param {string} options.excludeSocketId - Socket ID to exclude from broadcast
     */
    listUpdated(userId, listName, options = {}) {
      if (!io) {
        logger.warn('WebSocket not initialized, cannot broadcast list:updated');
        return;
      }

      const userRoom = `user:${userId}`;
      const payload = {
        listName,
        updatedAt: new Date().toISOString(),
      };

      if (options.excludeSocketId) {
        io.to(userRoom)
          .except(options.excludeSocketId)
          .emit('list:updated', payload);
      } else {
        io.to(userRoom).emit('list:updated', payload);
      }

      logger.debug('Broadcast list:updated', { userId, listName });
    },

    /**
     * Notify all clients of a user that a new list was created
     * @param {string} userId - User ID
     * @param {string} listName - Name of the new list
     * @param {number} year - Year of the list
     */
    listCreated(userId, listName, year) {
      if (!io) {
        logger.warn('WebSocket not initialized, cannot broadcast list:created');
        return;
      }

      const userRoom = `user:${userId}`;
      const payload = {
        listName,
        year,
        createdAt: new Date().toISOString(),
      };

      io.to(userRoom).emit('list:created', payload);
      logger.debug('Broadcast list:created', { userId, listName, year });
    },

    /**
     * Notify all clients of a user that a list was deleted
     * @param {string} userId - User ID
     * @param {string} listName - Name of the deleted list
     */
    listDeleted(userId, listName) {
      if (!io) {
        logger.warn('WebSocket not initialized, cannot broadcast list:deleted');
        return;
      }

      const userRoom = `user:${userId}`;
      const payload = {
        listName,
        deletedAt: new Date().toISOString(),
      };

      io.to(userRoom).emit('list:deleted', payload);
      logger.debug('Broadcast list:deleted', { userId, listName });
    },

    /**
     * Notify all clients of a user that a list was renamed
     * @param {string} userId - User ID
     * @param {string} oldName - Previous name of the list
     * @param {string} newName - New name of the list
     */
    listRenamed(userId, oldName, newName) {
      if (!io) {
        logger.warn('WebSocket not initialized, cannot broadcast list:renamed');
        return;
      }

      const userRoom = `user:${userId}`;
      const payload = {
        oldName,
        newName,
        renamedAt: new Date().toISOString(),
      };

      io.to(userRoom).emit('list:renamed', payload);
      logger.debug('Broadcast list:renamed', { userId, oldName, newName });
    },

    /**
     * Notify all clients of a user that a list's main status changed
     * @param {string} userId - User ID
     * @param {string} listName - Name of the list
     * @param {boolean} isMain - Whether the list is now the main list
     */
    listMainChanged(userId, listName, isMain) {
      if (!io) {
        logger.warn(
          'WebSocket not initialized, cannot broadcast list:main-changed'
        );
        return;
      }

      const userRoom = `user:${userId}`;
      const payload = {
        listName,
        isMain,
        changedAt: new Date().toISOString(),
      };

      io.to(userRoom).emit('list:main-changed', payload);
      logger.debug('Broadcast list:main-changed', { userId, listName, isMain });
    },
  };

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
