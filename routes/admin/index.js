/**
 * Admin Routes Aggregator
 *
 * Combines all admin route submodules into a single registration function.
 * This module handles the wiring between interdependent services.
 *
 * Submodules:
 * - users.js: User management (delete, admin grant/revoke, get lists)
 * - stats.js: Statistics endpoints
 * - backup.js: Database backup/restore operations
 * - events.js: Admin event system (returns adminEventService)
 * - telegram.js: Telegram bot configuration (requires adminEventService)
 * - album-summaries.js: Claude API batch operations
 * - duplicates.js: Duplicate scanning and merging
 * - audit.js: Aggregate list audit and manual album reconciliation
 * - images.js: Image refetch service
 * - reidentify.js: MusicBrainz album re-identification
 */

// Import all submodules
const registerUserRoutes = require('./users');
const registerStatsRoutes = require('./stats');
const registerBackupRoutes = require('./backup');
const registerEventRoutes = require('./events');
const registerTelegramRoutes = require('./telegram');
const registerAlbumSummaryRoutes = require('./album-summaries');
const registerDuplicateRoutes = require('./duplicates');
const registerAuditRoutes = require('./audit');
const registerImageRoutes = require('./images');
const registerReidentifyRoutes = require('./reidentify');

module.exports = (app, deps) => {
  // Register standalone modules (no interdependencies)
  registerUserRoutes(app, deps);
  registerStatsRoutes(app, deps);
  registerBackupRoutes(app, deps);
  registerAlbumSummaryRoutes(app, deps);
  registerDuplicateRoutes(app, deps);
  registerAuditRoutes(app, deps);
  registerImageRoutes(app, deps);
  registerReidentifyRoutes(app, deps);

  // Register events first - it returns the adminEventService
  const { adminEventService } = registerEventRoutes(app, deps);

  // Register telegram with the adminEventService for notifications
  registerTelegramRoutes(app, deps, adminEventService);
};
