/**
 * Admin Code Generation and Management
 *
 * Generates rotating admin access codes for admin role verification.
 * Codes rotate every 5 minutes and are logged for Loki/Grafana parsing.
 */

const logger = require('../utils/logger');

// Admin code state
let adminCode = null;
let adminCodeExpiry = null;
let lastCodeUsedBy = null;
let lastCodeUsedAt = null;
const adminCodeAttempts = new Map(); // Track failed attempts

/**
 * Generate a new admin access code.
 * Outputs structured JSON log for Loki/Grafana parsing.
 */
function generateAdminCode() {
  try {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    adminCode = Array.from(
      { length: 8 },
      () => chars[Math.floor(Math.random() * chars.length)]
    ).join('');
    adminCodeExpiry = new Date(Date.now() + 5 * 60 * 1000);

    // Log admin code using structured logging (parseable by Loki)
    const logData = {
      code: adminCode,
      expiresAt: adminCodeExpiry.toISOString(),
      ttlSeconds: 300,
    };

    // Include previous usage info if available
    if (lastCodeUsedBy && lastCodeUsedAt) {
      logData.previousUsage = {
        usedBy: lastCodeUsedBy,
        usedAt: new Date(lastCodeUsedAt).toISOString(),
      };
    }

    logger.info('Admin access code generated', logData);

    // Reset tracking for new code
    lastCodeUsedBy = null;
    lastCodeUsedAt = null;
  } catch (error) {
    logger.error('Error generating admin code', { error: error.message });
  }
}

/**
 * Get the current admin code state.
 * Returns references that allow the auth routes to read current values.
 * @returns {Object} Admin code state accessors
 */
function getAdminCodeState() {
  return {
    get adminCode() {
      return adminCode;
    },
    get adminCodeExpiry() {
      return adminCodeExpiry;
    },
    get lastCodeUsedBy() {
      return lastCodeUsedBy;
    },
    set lastCodeUsedBy(val) {
      lastCodeUsedBy = val;
    },
    get lastCodeUsedAt() {
      return lastCodeUsedAt;
    },
    set lastCodeUsedAt(val) {
      lastCodeUsedAt = val;
    },
    adminCodeAttempts,
    generateAdminCode,
  };
}

/**
 * Start admin code rotation.
 * Generates an initial code and sets up a 5-minute rotation interval.
 */
function startAdminCodeRotation() {
  generateAdminCode();
  setInterval(generateAdminCode, 5 * 60 * 1000);
}

module.exports = {
  getAdminCodeState,
  startAdminCodeRotation,
  generateAdminCode,
};
