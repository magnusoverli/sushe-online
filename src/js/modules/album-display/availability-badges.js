/**
 * Platform availability badges for the album column.
 *
 * Renders small, icon-only, brand-coloured squares for the platforms that
 * provide an album. A fixed priority order is applied, and badges become links
 * only when the backend supplies a URL matching the expected provider.
 */

import { escapeHtmlAttr as escapeHtml } from '../html-utils.js';

// service -> { label, icon (Font Awesome brand class | null), color }.
// Platforms without a brand icon render their initial letter instead.
const PLATFORM_BADGES = {
  spotify: { label: 'Spotify', icon: 'fa-spotify', color: '#1db954' },
  itunes: { label: 'iTunes', icon: 'fa-apple', color: '#fa243c' },
  qobuz: { label: 'Qobuz', icon: null, color: '#1f1f1f' },
  tidal: { label: 'Tidal', icon: null, color: '#33b6c9' },
  bandcamp: { label: 'Bandcamp', icon: 'fa-bandcamp', color: '#629aa9' },
  soundcloud: {
    label: 'SoundCloud',
    icon: 'fa-soundcloud',
    color: '#ff5500',
  },
  youtube: { label: 'YouTube', icon: 'fa-youtube', color: '#ff0000' },
};

// Order badges are shown in.
const PLATFORM_PRIORITY = [
  'spotify',
  'itunes',
  'qobuz',
  'tidal',
  'bandcamp',
  'soundcloud',
  'youtube',
];

const PLATFORM_HOSTS = {
  spotify: ['spotify.com'],
  itunes: ['music.apple.com', 'itunes.apple.com'],
  qobuz: ['qobuz.com'],
  tidal: ['tidal.com'],
  bandcamp: ['bandcamp.com'],
  soundcloud: ['soundcloud.com'],
  youtube: ['youtube.com', 'youtu.be'],
};

function hostMatches(hostname, allowedHost) {
  return hostname === allowedHost || hostname.endsWith(`.${allowedHost}`);
}

function validatedPlatformUrl(service, rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 2048) return null;

  try {
    const parsed = new URL(rawUrl);
    const validHost = PLATFORM_HOSTS[service]?.some((host) =>
      hostMatches(parsed.hostname.toLowerCase(), host)
    );
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      !validHost
    ) {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

function badgeInner(meta) {
  return meta.icon
    ? `<i class="fab ${meta.icon}"></i>`
    : `<span class="availability-badge-letter">${meta.label.charAt(0)}</span>`;
}

/**
 * Build the availability badge row HTML for an album. Returns '' when there is
 * nothing to show (so the album cell keeps its original layout).
 *
 * @param {string[]} availability - canonical service names available for the album
 * @param {Object} [options]
 * @param {'mobile'} [options.variant] - 'mobile' renders smaller, centered
 *   badges sized to fit the narrow cover column on a mobile album card.
 * @param {{service: string, url: string}[]} [options.links] - validated backend
 *   provider links; invalid or mismatched URLs render as non-link badges.
 * @returns {string} HTML for the badge row, or ''
 */
export function renderAvailabilityBadges(
  availability,
  { variant, links = [] } = {}
) {
  if (!Array.isArray(availability) || availability.length === 0) return '';

  const have = new Set(availability);
  const chosen = PLATFORM_PRIORITY.filter((service) => have.has(service));
  if (chosen.length === 0) return '';

  const urls = new Map();
  if (Array.isArray(links)) {
    links.forEach((link) => {
      if (!link || urls.has(link.service)) return;
      const url = validatedPlatformUrl(link.service, link.url);
      if (url) urls.set(link.service, url);
    });
  }

  const squares = chosen
    .map((service) => {
      const meta = PLATFORM_BADGES[service];
      const label = escapeHtml(meta.label);
      const attributes = `class="availability-badge" style="background-color:${meta.color}" title="${label}" aria-label="${label}"`;
      const url = urls.get(service);
      return url
        ? `<a ${attributes} href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${badgeInner(meta)}</a>`
        : `<span ${attributes}>${badgeInner(meta)}</span>`;
    })
    .join('');

  const variantClass =
    variant === 'mobile' ? ' album-availability--mobile' : '';
  return `<div class="album-availability${variantClass}">${squares}</div>`;
}
