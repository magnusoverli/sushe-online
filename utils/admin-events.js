// utils/admin-events.js
// Core admin event service - handles events that require admin action
// Works independently of Telegram; Telegram is an optional notification layer

const logger = require('./logger');

/**
 * Create admin event service with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.pool - PostgreSQL connection pool
 * @param {Object} deps.logger - Logger instance
 * @param {Function} deps.telegramNotifier - Optional telegram notifier function
 */
function createAdminEventService(deps = {}) {
  const log = deps.logger || logger;
  const pool = deps.pool;
  let telegramNotifier = deps.telegramNotifier || null;

  // Action handlers registry: { eventType: { action: handler } }
  const actionHandlers = new Map();

  /**
   * Register an action handler for a specific event type and action
   * @param {string} eventType - Event type (e.g., 'account_approval')
   * @param {string} action - Action name (e.g., 'approve', 'reject')
   * @param {Function} handler - Async function(eventData, adminUser) => { success, message }
   */
  function registerActionHandler(eventType, action, handler) {
    if (!actionHandlers.has(eventType)) {
      actionHandlers.set(eventType, new Map());
    }
    actionHandlers.get(eventType).set(action, handler);
    log.debug(`Registered action handler: ${eventType}/${action}`);
  }

  /**
   * Get available actions for an event type
   * @param {string} eventType - Event type
   * @returns {string[]} - Array of action names
   */
  function getAvailableActions(eventType) {
    const handlers = actionHandlers.get(eventType);
    return handlers ? Array.from(handlers.keys()) : [];
  }

  /**
   * Create a new admin event
   * @param {Object} options - Event options
   * @param {string} options.type - Event type
   * @param {string} options.title - Human-readable title
   * @param {string} options.description - Event description
   * @param {Object} options.data - Event-specific payload
   * @param {string} options.priority - 'low', 'normal', 'high', 'urgent'
   * @param {Array} options.actions - Available actions [{id, label}]
   * @returns {Object} - Created event
   */
  async function createEvent({
    type,
    title,
    description = null,
    data = {},
    priority = 'normal',
    actions = [],
  }) {
    if (!pool) {
      throw new Error('Database pool not configured');
    }

    const result = await pool.query(
      `INSERT INTO admin_events (event_type, title, description, data, priority)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [type, title, description, JSON.stringify(data), priority]
    );

    const event = result.rows[0];
    log.info(`Admin event created: ${type}`, { eventId: event.id, title });

    // Notify via Telegram if configured
    if (
      telegramNotifier &&
      typeof telegramNotifier.notifyNewEvent === 'function'
    ) {
      try {
        const telegramResult = await telegramNotifier.notifyNewEvent(
          event,
          actions
        );
        if (telegramResult && telegramResult.messageId) {
          // Store telegram message ID for later updates
          await pool.query(
            `UPDATE admin_events 
             SET telegram_message_id = $1, telegram_chat_id = $2 
             WHERE id = $3`,
            [telegramResult.messageId, telegramResult.chatId, event.id]
          );
          event.telegram_message_id = telegramResult.messageId;
          event.telegram_chat_id = telegramResult.chatId;
        }
      } catch (err) {
        log.error('Failed to send Telegram notification:', err);
        // Don't fail event creation if Telegram fails
      }
    }

    return event;
  }

  /**
   * Get pending events with optional filters
   * @param {Object} filters - Optional filters
   * @param {string} filters.type - Filter by event type
   * @param {string} filters.priority - Filter by priority
   * @param {number} filters.limit - Max results (default 50)
   * @param {number} filters.offset - Offset for pagination
   * @returns {Object} - { events, total }
   */
  async function getPendingEvents(filters = {}) {
    if (!pool) {
      throw new Error('Database pool not configured');
    }

    const { type, priority, limit = 50, offset = 0 } = filters;
    const conditions = ["status = 'pending'"];
    const params = [];
    let paramIndex = 1;

    if (type) {
      conditions.push(`event_type = $${paramIndex++}`);
      params.push(type);
    }

    if (priority) {
      conditions.push(`priority = $${paramIndex++}`);
      params.push(priority);
    }

    const whereClause = conditions.join(' AND ');

    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM admin_events WHERE ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    // Get events
    const eventsResult = await pool.query(
      `SELECT * FROM admin_events 
       WHERE ${whereClause}
       ORDER BY 
         CASE priority 
           WHEN 'urgent' THEN 1 
           WHEN 'high' THEN 2 
           WHEN 'normal' THEN 3 
           WHEN 'low' THEN 4 
         END,
         created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, limit, offset]
    );

    return {
      events: eventsResult.rows,
      total,
      limit,
      offset,
    };
  }

  /**
   * Get a single event by ID
   * @param {string} eventId - Event UUID
   * @returns {Object|null} - Event or null if not found
   */
  async function getEventById(eventId) {
    if (!pool) {
      throw new Error('Database pool not configured');
    }

    const result = await pool.query(
      'SELECT * FROM admin_events WHERE id = $1',
      [eventId]
    );

    return result.rows[0] || null;
  }

  /**
   * Get event history (resolved events)
   * @param {Object} options - Query options
   * @param {number} options.limit - Max results (default 50)
   * @param {number} options.offset - Offset for pagination
   * @param {string} options.type - Filter by event type
   * @returns {Object} - { events, total }
   */
  async function getEventHistory({ limit = 50, offset = 0, type = null } = {}) {
    if (!pool) {
      throw new Error('Database pool not configured');
    }

    const conditions = ["status != 'pending'"];
    const params = [];
    let paramIndex = 1;

    if (type) {
      conditions.push(`event_type = $${paramIndex++}`);
      params.push(type);
    }

    const whereClause = conditions.join(' AND ');

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM admin_events WHERE ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const eventsResult = await pool.query(
      `SELECT ae.*, u.username as resolved_by_username
       FROM admin_events ae
       LEFT JOIN users u ON ae.resolved_by = u._id
       WHERE ${whereClause}
       ORDER BY resolved_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, limit, offset]
    );

    return {
      events: eventsResult.rows,
      total,
      limit,
      offset,
    };
  }

  /**
   * Execute an action on an event
   * @param {string} eventId - Event UUID
   * @param {string} action - Action to execute
   * @param {Object} adminUser - Admin user executing the action
   * @param {string} resolvedVia - 'web' or 'telegram'
   * @returns {Object} - { success, message, event }
   */
  async function executeAction(
    eventId,
    action,
    adminUser,
    resolvedVia = 'web'
  ) {
    if (!pool) {
      throw new Error('Database pool not configured');
    }

    // Get the event
    const event = await getEventById(eventId);
    if (!event) {
      return { success: false, message: 'Event not found' };
    }

    if (event.status !== 'pending') {
      return {
        success: false,
        message: `Event already resolved (${event.status})`,
      };
    }

    // Get the handler
    const typeHandlers = actionHandlers.get(event.event_type);
    if (!typeHandlers) {
      return {
        success: false,
        message: `No handlers for event type: ${event.event_type}`,
      };
    }

    const handler = typeHandlers.get(action);
    if (!handler) {
      return { success: false, message: `No handler for action: ${action}` };
    }

    // Execute the handler
    let handlerResult;
    try {
      handlerResult = await handler(event.data, adminUser, event);
    } catch (err) {
      log.error(`Action handler error: ${event.event_type}/${action}`, err);
      return { success: false, message: `Action failed: ${err.message}` };
    }

    if (!handlerResult.success) {
      return handlerResult;
    }

    // Determine the new status based on the action
    const status = action === 'dismiss' ? 'dismissed' : action;

    // Update the event
    const updateResult = await pool.query(
      `UPDATE admin_events 
       SET status = $1, resolved_at = NOW(), resolved_by = $2, resolved_via = $3
       WHERE id = $4
       RETURNING *`,
      [status, adminUser._id, resolvedVia, eventId]
    );

    const updatedEvent = updateResult.rows[0];
    log.info(`Admin event resolved: ${event.event_type}/${action}`, {
      eventId,
      resolvedBy: adminUser.username,
      resolvedVia,
    });

    // Update Telegram message if applicable
    if (
      telegramNotifier &&
      typeof telegramNotifier.updateEventMessage === 'function' &&
      event.telegram_message_id
    ) {
      try {
        await telegramNotifier.updateEventMessage(
          updatedEvent,
          action,
          adminUser.username
        );
      } catch (err) {
        log.error('Failed to update Telegram message:', err);
        // Don't fail the action if Telegram update fails
      }
    }

    return {
      success: true,
      message: handlerResult.message || `Action '${action}' completed`,
      event: updatedEvent,
    };
  }

  /**
   * Get pending event count for dashboard badge
   * @returns {number} - Count of pending events
   */
  async function getPendingCount() {
    if (!pool) {
      return 0;
    }

    const result = await pool.query(
      "SELECT COUNT(*) FROM admin_events WHERE status = 'pending'"
    );
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Get counts by priority for dashboard
   * @returns {Object} - { urgent, high, normal, low, total }
   */
  async function getPendingCountsByPriority() {
    if (!pool) {
      return { urgent: 0, high: 0, normal: 0, low: 0, total: 0 };
    }

    const result = await pool.query(`
      SELECT priority, COUNT(*) as count 
      FROM admin_events 
      WHERE status = 'pending'
      GROUP BY priority
    `);

    const counts = { urgent: 0, high: 0, normal: 0, low: 0, total: 0 };
    for (const row of result.rows) {
      counts[row.priority] = parseInt(row.count, 10);
      counts.total += parseInt(row.count, 10);
    }

    return counts;
  }

  /**
   * Set the Telegram notifier (for late binding)
   * @param {Object} notifier - Telegram notifier instance
   */
  function setTelegramNotifier(notifier) {
    telegramNotifier = notifier;
  }

  return {
    // Event management
    createEvent,
    getPendingEvents,
    getEventById,
    getEventHistory,
    executeAction,
    getPendingCount,
    getPendingCountsByPriority,

    // Action handler registration
    registerActionHandler,
    getAvailableActions,

    // Late binding
    setTelegramNotifier,
  };
}

// Export factory and create default instance
module.exports = {
  createAdminEventService,
};
