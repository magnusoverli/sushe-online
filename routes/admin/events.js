/**
 * Admin Events API Routes
 *
 * Core event system for admin actions (works with or without Telegram)
 * Handles account approval workflows and event management:
 * - /api/admin/events - Get pending events
 * - /api/admin/events/history - Get event history
 * - /api/admin/events/counts - Get event counts by priority
 * - /api/admin/events/:eventId - Get single event
 * - /api/admin/events/:eventId/action/:action - Execute action on event
 * - /api/admin/events/actions/:eventType - Get available actions
 */

const logger = require('../../utils/logger');
const { createAdminEventService } = require('../../utils/admin-events');

module.exports = (app, deps) => {
  const { ensureAuth, ensureAdmin, usersAsync, pool } = deps;

  // Create admin event service instance
  const adminEventService = createAdminEventService({ pool, logger });

  // Register handlers for account_approval events (approve/reject new registrations)
  adminEventService.registerActionHandler(
    'account_approval',
    'approve',
    async (eventData, adminUser) => {
      const { userId, username } = eventData;

      if (!userId) {
        return { success: false, message: 'Missing user ID in event data' };
      }

      try {
        // Update user's approval status to 'approved'
        const result = await usersAsync.update(
          { _id: userId },
          { $set: { approvalStatus: 'approved', updatedAt: new Date() } }
        );

        if (result === 0) {
          return { success: false, message: 'User not found' };
        }

        logger.info(`User registration approved: ${username}`, {
          userId,
          approvedBy: adminUser.username,
        });

        return {
          success: true,
          message: `Approved registration for ${username}`,
        };
      } catch (err) {
        logger.error('Error approving user registration:', err);
        return { success: false, message: 'Database error' };
      }
    }
  );

  adminEventService.registerActionHandler(
    'account_approval',
    'reject',
    async (eventData, adminUser) => {
      const { userId, username } = eventData;

      if (!userId) {
        return { success: false, message: 'Missing user ID in event data' };
      }

      try {
        // Update user's approval status to 'rejected' (keep for audit trail)
        const result = await usersAsync.update(
          { _id: userId },
          { $set: { approvalStatus: 'rejected', updatedAt: new Date() } }
        );

        if (result === 0) {
          return { success: false, message: 'User not found' };
        }

        logger.info(`User registration rejected: ${username}`, {
          userId,
          rejectedBy: adminUser.username,
        });

        return {
          success: true,
          message: `Rejected registration for ${username}`,
        };
      } catch (err) {
        logger.error('Error rejecting user registration:', err);
        return { success: false, message: 'Database error' };
      }
    }
  );

  // Get pending events
  app.get('/api/admin/events', ensureAuth, ensureAdmin, async (req, res) => {
    try {
      const { type, priority, limit, offset } = req.query;
      const result = await adminEventService.getPendingEvents({
        type,
        priority,
        limit: limit ? parseInt(limit, 10) : 50,
        offset: offset ? parseInt(offset, 10) : 0,
      });
      res.json(result);
    } catch (error) {
      logger.error('Error fetching admin events', { error: error.message });
      res.status(500).json({ error: 'Failed to fetch events' });
    }
  });

  // Get event history
  app.get(
    '/api/admin/events/history',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const { type, limit, offset } = req.query;
        const result = await adminEventService.getEventHistory({
          type,
          limit: limit ? parseInt(limit, 10) : 50,
          offset: offset ? parseInt(offset, 10) : 0,
        });
        res.json(result);
      } catch (error) {
        logger.error('Error fetching event history', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch event history' });
      }
    }
  );

  // Get pending event counts (for dashboard badge)
  app.get(
    '/api/admin/events/counts',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const counts = await adminEventService.getPendingCountsByPriority();
        res.json(counts);
      } catch (error) {
        logger.error('Error fetching event counts', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch counts' });
      }
    }
  );

  // Get single event by ID
  app.get(
    '/api/admin/events/:eventId',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const event = await adminEventService.getEventById(req.params.eventId);
        if (!event) {
          return res.status(404).json({ error: 'Event not found' });
        }
        res.json(event);
      } catch (error) {
        logger.error('Error fetching event', {
          error: error.message,
          eventId: req.params.eventId,
        });
        res.status(500).json({ error: 'Failed to fetch event' });
      }
    }
  );

  // Execute action on event
  app.post(
    '/api/admin/events/:eventId/action/:action',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const { eventId, action } = req.params;
        const result = await adminEventService.executeAction(
          eventId,
          action,
          req.user,
          'web'
        );

        if (!result.success) {
          return res.status(400).json({ error: result.message });
        }

        res.json({
          success: true,
          message: result.message,
          event: result.event,
        });
      } catch (error) {
        logger.error('Error executing event action', {
          error: error.message,
          eventId: req.params.eventId,
          action: req.params.action,
        });
        res.status(500).json({ error: 'Failed to execute action' });
      }
    }
  );

  // Get available actions for an event type
  app.get(
    '/api/admin/events/actions/:eventType',
    ensureAuth,
    ensureAdmin,
    (req, res) => {
      const actions = adminEventService.getAvailableActions(
        req.params.eventType
      );
      res.json({ actions });
    }
  );

  // Expose admin event service for use by other modules
  app.locals.adminEventService = adminEventService;

  // Return the service so telegram.js can wire up to it
  return { adminEventService };
};
