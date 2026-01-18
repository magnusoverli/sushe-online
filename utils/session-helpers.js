/**
 * Session Helper Utilities
 *
 * Provides async/await wrappers for Express session operations.
 * Express sessions use callbacks by default, which can lead to
 * inconsistent error handling and race conditions.
 *
 * This module provides:
 * - saveSessionAsync: Promise-based session save with proper error handling
 * - saveSessionSafe: Fire-and-forget session save with error logging
 */

const logger = require('./logger');

/**
 * Save session with async/await support
 *
 * Wraps req.session.save() in a Promise for proper async flow control.
 * Use this when you need to wait for the session to be saved before
 * continuing (e.g., before redirecting after login).
 *
 * @param {Object} req - Express request object with session
 * @returns {Promise<void>} - Resolves when session is saved, rejects on error
 * @throws {Error} - Throws if session save fails
 *
 * @example
 * async function loginHandler(req, res) {
 *   req.session.userId = user._id;
 *   await saveSessionAsync(req);
 *   res.redirect('/dashboard');
 * }
 */
async function saveSessionAsync(req) {
  return new Promise((resolve, reject) => {
    req.session.save((err) => {
      if (err) {
        logger.error('Session save failed', {
          error: err.message,
          sessionId: req.session?.id,
          userId: req.session?.passport?.user,
        });
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Save session without waiting (fire-and-forget)
 *
 * Saves the session asynchronously and logs any errors without blocking.
 * Use this for non-critical session updates where you don't need to
 * wait for completion before responding.
 *
 * @param {Object} req - Express request object with session
 * @param {string} context - Description of what triggered the save (for logging)
 * @returns {void}
 *
 * @example
 * // Update last activity timestamp without blocking response
 * req.session.lastActivity = new Date();
 * saveSessionSafe(req, 'lastActivity update');
 * res.json({ success: true });
 */
function saveSessionSafe(req, context = 'session update') {
  req.session.save((err) => {
    if (err) {
      logger.error('Session save failed (non-blocking)', {
        context,
        error: err.message,
        sessionId: req.session?.id,
        userId: req.session?.passport?.user,
      });
    }
  });
}

/**
 * Regenerate session with async/await support
 *
 * Wraps req.session.regenerate() in a Promise for security-critical
 * operations like login where session fixation attacks must be prevented.
 *
 * @param {Object} req - Express request object with session
 * @returns {Promise<void>} - Resolves when session is regenerated
 * @throws {Error} - Throws if session regeneration fails
 *
 * @example
 * async function loginHandler(req, res) {
 *   await regenerateSessionAsync(req);
 *   req.session.userId = user._id;
 *   await saveSessionAsync(req);
 *   res.redirect('/dashboard');
 * }
 */
async function regenerateSessionAsync(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) {
        logger.error('Session regeneration failed', {
          error: err.message,
          sessionId: req.session?.id,
        });
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Destroy session with async/await support
 *
 * Wraps req.session.destroy() in a Promise for logout operations.
 *
 * @param {Object} req - Express request object with session
 * @returns {Promise<void>} - Resolves when session is destroyed
 * @throws {Error} - Throws if session destruction fails
 *
 * @example
 * async function logoutHandler(req, res) {
 *   await destroySessionAsync(req);
 *   res.clearCookie('connect.sid');
 *   res.redirect('/');
 * }
 */
async function destroySessionAsync(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => {
      if (err) {
        logger.error('Session destruction failed', {
          error: err.message,
        });
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

module.exports = {
  saveSessionAsync,
  saveSessionSafe,
  regenerateSessionAsync,
  destroySessionAsync,
};
