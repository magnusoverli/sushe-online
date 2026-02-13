/**
 * Session Helper Utilities
 *
 * Provides async/await wrappers for Express session operations.
 * Express sessions use callbacks by default, which can lead to
 * inconsistent error handling and race conditions.
 *
 * Uses dependency injection via createSessionHelpers(deps) factory.
 * Tests can inject a mock logger; production uses the default instance.
 */

/**
 * Factory that creates session helper functions with injectable dependencies.
 *
 * @param {Object} deps - Dependencies
 * @param {Object} deps.logger - Logger with error() method
 * @returns {{ saveSessionAsync: Function, saveSessionSafe: Function }}
 */
function createSessionHelpers(deps = {}) {
  const logger = deps.logger || require('./logger');

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

  return { saveSessionAsync, saveSessionSafe };
}

// Default instance for production use — callers import as before
const defaultInstance = createSessionHelpers();

module.exports = { createSessionHelpers, ...defaultInstance };
