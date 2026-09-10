/**
 * Validation helpers for external URL unfurling.
 */

const net = require('net');
const { isPublicAddress, normalizeHostname } = require('./public-address');

function isDisallowedHost(hostname) {
  const normalizedHost = normalizeHostname(hostname);

  if (
    normalizedHost === 'localhost' ||
    normalizedHost.endsWith('.localhost') ||
    normalizedHost.endsWith('.local')
  ) {
    return true;
  }

  const ipType = net.isIP(normalizedHost);
  if (ipType) return !isPublicAddress(normalizedHost);

  return false;
}

function validateUnfurlTarget(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    return { valid: false, error: 'url query is required' };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_error) {
    return { valid: false, error: 'Invalid URL format' };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { valid: false, error: 'Only http and https URLs are allowed' };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, error: 'URLs with credentials are not allowed' };
  }

  if (isDisallowedHost(parsed.hostname)) {
    return { valid: false, error: 'URL host is not allowed' };
  }

  return { valid: true, url: parsed.toString() };
}

module.exports = {
  validateUnfurlTarget,
};
