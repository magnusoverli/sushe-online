/**
 * Validation helpers for external URL unfurling.
 */

const net = require('net');

function isPrivateIpv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) {
    return false;
  }

  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 0) return true;
  return false;
}

function isPrivateIpv6(ip) {
  const normalized = ip.toLowerCase();

  if (normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9')) return true;
  if (normalized.startsWith('fea') || normalized.startsWith('feb')) return true;

  const v4MappedMatch = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4MappedMatch) {
    return isPrivateIpv4(v4MappedMatch[1]);
  }

  return false;
}

function isDisallowedHost(hostname) {
  const lower = hostname.toLowerCase();
  const normalizedHost =
    lower.startsWith('[') && lower.endsWith(']') ? lower.slice(1, -1) : lower;

  if (
    normalizedHost === 'localhost' ||
    normalizedHost.endsWith('.localhost') ||
    normalizedHost.endsWith('.local')
  ) {
    return true;
  }

  const ipType = net.isIP(normalizedHost);
  if (ipType === 4) {
    return isPrivateIpv4(normalizedHost);
  }

  if (ipType === 6) {
    return isPrivateIpv6(normalizedHost);
  }

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
  isPrivateIpv4,
  isPrivateIpv6,
  isDisallowedHost,
  validateUnfurlTarget,
};
