/**
 * Platform availability badges for the album column.
 *
 * Renders small, icon-only, brand-coloured squares for the platforms that
 * provide an album. Visual only (no links). A fixed priority order is applied
 * and the count is capped so they fit on one line below the release date.
 */

// service -> { label, icon (Font Awesome brand class | null), color }.
// Platforms without a brand icon render their initial letter instead.
const PLATFORM_BADGES = {
  spotify: { label: 'Spotify', icon: 'fa-spotify', color: '#1db954' },
  itunes: { label: 'iTunes', icon: 'fa-apple', color: '#fa243c' },
  qobuz: { label: 'Qobuz', icon: null, color: '#1f1f1f' },
  tidal: { label: 'Tidal', icon: null, color: '#33b6c9' },
  bandcamp: { label: 'Bandcamp', icon: 'fa-bandcamp', color: '#629aa9' },
};

// Order badges are shown in.
const PLATFORM_PRIORITY = ['spotify', 'itunes', 'qobuz', 'tidal', 'bandcamp'];

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
 * @returns {string} HTML for the badge row, or ''
 */
export function renderAvailabilityBadges(availability, { variant } = {}) {
  if (!Array.isArray(availability) || availability.length === 0) return '';

  const have = new Set(availability);
  const chosen = PLATFORM_PRIORITY.filter((service) => have.has(service));
  if (chosen.length === 0) return '';

  const squares = chosen
    .map((service) => {
      const meta = PLATFORM_BADGES[service];
      return `<span class="availability-badge" style="background-color:${meta.color}" title="${meta.label}" aria-label="${meta.label}">${badgeInner(meta)}</span>`;
    })
    .join('');

  const variantClass =
    variant === 'mobile' ? ' album-availability--mobile' : '';
  return `<div class="album-availability${variantClass}">${squares}</div>`;
}
