// services/admin-events.js
// Core admin event service - handles events that require admin action
// Works independently of Telegram; Telegram is an optional notification layer

const logger = require('../utils/logger');

// ============================================
// QUERY BUILDER HELPERS
// ============================================

/**
 * Build WHERE clause and params for event queries
 * @param {Object} filters - Filter options
 * @param {string} baseCondition - Base condition (e.g., "status = 'pending'")
 * @returns {Object} - { whereClause, params, nextParamIndex }
 */
function buildEventQueryFilters(filters, baseCondition) {
  const { type, priority } = filters;
  const conditions = [baseCondition];
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

  return {
    whereClause: conditions.join(' AND '),
    params,
    nextParamIndex: paramIndex,
  };
}

/**
 * Get count of rows matching filters
 */
async function getEventCount(pool, whereClause, params) {
  const result = await pool.query(
    `SELECT COUNT(*) FROM admin_events WHERE ${whereClause}`,
    params
  );
  return parseInt(result.rows[0].count, 10);
}

/**
 * Update event status after action execution
 */
async function updateEventStatus(
  pool,
  eventId,
  action,
  adminUser,
  resolvedVia
) {
  const status = action === 'dismiss' ? 'dismissed' : action;
  const resolvedById = adminUser.source === 'telegram' ? null : adminUser._id;

  const updateResult = await pool.query(
    `UPDATE admin_events 
     SET status = $1, resolved_at = NOW(), resolved_by = $2, resolved_via = $3
     WHERE id = $4
     RETURNING *`,
    [status, resolvedById, resolvedVia, eventId]
  );

  return updateResult.rows[0];
}

/**
 * Notify Telegram about a new event and update the event record
 */
async function notifyTelegramForEvent(
  pool,
  telegramNotifier,
  event,
  actions,
  log
) {
  if (
    !telegramNotifier ||
    typeof telegramNotifier.notifyNewEvent !== 'function'
  )
    return;

  try {
    const telegramResult = await telegramNotifier.notifyNewEvent(
      event,
      actions
    );
    if (telegramResult?.messageId) {
      await pool.query(
        `UPDATE admin_events SET telegram_message_id = $1, telegram_chat_id = $2 WHERE id = $3`,
        [telegramResult.messageId, telegramResult.chatId, event.id]
      );
      event.telegram_message_id = telegramResult.messageId;
      event.telegram_chat_id = telegramResult.chatId;
    }
  } catch (err) {
    log.error('Failed to send Telegram notification:', err);
  }
}

/**
 * Notify Telegram about an event update
 */
async function notifyTelegramForUpdate(
  telegramNotifier,
  event,
  action,
  adminUsername,
  log
) {
  if (
    !telegramNotifier ||
    typeof telegramNotifier.updateEventMessage !== 'function'
  )
    return;
  if (!event.telegram_message_id) return;

  try {
    await telegramNotifier.updateEventMessage(event, action, adminUsername);
  } catch (err) {
    log.error('Failed to update Telegram message:', err);
  }
}

// ============================================
// MAIN FACTORY
// ============================================

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

  const actionHandlers = new Map();

  /**
   * Register an action handler for a specific event type and action
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
   */
  function getAvailableActions(eventType) {
    const handlers = actionHandlers.get(eventType);
    return handlers ? Array.from(handlers.keys()) : [];
  }

  /**
   * Create a new admin event
   */
  async function createEvent({
    type,
    title,
    description = null,
    data = {},
    priority = 'normal',
    actions = [],
  }) {
    if (!pool) throw new Error('Database pool not configured');

    const result = await pool.query(
      `INSERT INTO admin_events (event_type, title, description, data, priority, actions)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        type,
        title,
        description,
        JSON.stringify(data),
        priority,
        JSON.stringify(actions),
      ]
    );

    const event = result.rows[0];
    log.info(`Admin event created: ${type}`, { eventId: event.id, title });

    await notifyTelegramForEvent(pool, telegramNotifier, event, actions, log);

    return event;
  }

  /**
   * Get pending events with optional filters
   */
  async function getPendingEvents(filters = {}) {
    if (!pool) throw new Error('Database pool not configured');

    const { limit = 50, offset = 0 } = filters;
    const { whereClause, params, nextParamIndex } = buildEventQueryFilters(
      filters,
      "status = 'pending'"
    );

    const total = await getEventCount(pool, whereClause, params);

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
       LIMIT $${nextParamIndex} OFFSET $${nextParamIndex + 1}`,
      [...params, limit, offset]
    );

    return { events: eventsResult.rows, total, limit, offset };
  }

  /**
   * Get a single event by ID
   */
  async function getEventById(eventId) {
    if (!pool) throw new Error('Database pool not configured');

    const result = await pool.query(
      'SELECT * FROM admin_events WHERE id = $1',
      [eventId]
    );
    return result.rows[0] || null;
  }

  /**
   * Get event history (resolved events)
   */
  async function getEventHistory({ limit = 50, offset = 0, type = null } = {}) {
    if (!pool) throw new Error('Database pool not configured');

    const { whereClause, params, nextParamIndex } = buildEventQueryFilters(
      { type },
      "status != 'pending'"
    );

    const total = await getEventCount(pool, whereClause, params);

    const eventsResult = await pool.query(
      `SELECT ae.*, u.username as resolved_by_username
       FROM admin_events ae
       LEFT JOIN users u ON ae.resolved_by = u._id
       WHERE ${whereClause}
       ORDER BY resolved_at DESC
       LIMIT $${nextParamIndex} OFFSET $${nextParamIndex + 1}`,
      [...params, limit, offset]
    );

    return { events: eventsResult.rows, total, limit, offset };
  }

  /**
   * Execute an action on an event
   */
  async function executeAction(
    eventId,
    action,
    adminUser,
    resolvedVia = 'web'
  ) {
    if (!pool) throw new Error('Database pool not configured');

    const event = await getEventById(eventId);
    if (!event) return { success: false, message: 'Event not found' };
    if (event.status !== 'pending') {
      return {
        success: false,
        message: `Event already resolved (${event.status})`,
      };
    }

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

    let handlerResult;
    try {
      handlerResult = await handler(event.data, adminUser, event);
    } catch (err) {
      log.error(`Action handler error: ${event.event_type}/${action}`, err);
      return { success: false, message: `Action failed: ${err.message}` };
    }

    if (!handlerResult.success) return handlerResult;

    const updatedEvent = await updateEventStatus(
      pool,
      eventId,
      action,
      adminUser,
      resolvedVia
    );
    log.info(`Admin event resolved: ${event.event_type}/${action}`, {
      eventId,
      resolvedBy: adminUser.username,
      resolvedVia,
    });

    await notifyTelegramForUpdate(
      telegramNotifier,
      updatedEvent,
      action,
      adminUser.username,
      log
    );

    return {
      success: true,
      message: handlerResult.message || `Action '${action}' completed`,
      event: updatedEvent,
    };
  }

  /**
   * Get pending event count for dashboard badge
   */
  async function getPendingCount() {
    if (!pool) return 0;

    const result = await pool.query(
      "SELECT COUNT(*) FROM admin_events WHERE status = 'pending'"
    );
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Get counts by priority for dashboard
   */
  async function getPendingCountsByPriority() {
    if (!pool) return { urgent: 0, high: 0, normal: 0, low: 0, total: 0 };

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
   */
  function setTelegramNotifier(notifier) {
    telegramNotifier = notifier;
  }

  return {
    createEvent,
    getPendingEvents,
    getEventById,
    getEventHistory,
    executeAction,
    getPendingCount,
    getPendingCountsByPriority,
    registerActionHandler,
    getAvailableActions,
    setTelegramNotifier,
  };
}

module.exports = {
  createAdminEventService,
};
