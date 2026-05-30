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
  apple_music: { label: 'Apple Music', icon: 'fa-apple', color: '#fa243c' },
  tidal: { label: 'Tidal', icon: null, color: '#33b6c9' },
  deezer: { label: 'Deezer', icon: 'fa-deezer', color: '#a238ff' },
  youtube_music: {
    label: 'YouTube Music',
    icon: 'fa-youtube',
    color: '#ff0000',
  },
  bandcamp: { label: 'Bandcamp', icon: 'fa-bandcamp', color: '#629aa9' },
  soundcloud: { label: 'SoundCloud', icon: 'fa-soundcloud', color: '#ff5500' },
  amazon_music: { label: 'Amazon Music', icon: 'fa-amazon', color: '#25d1da' },
};

// Order badges are shown in; only the first MAX_BADGES present are rendered.
const PLATFORM_PRIORITY = [
  'spotify',
  'apple_music',
  'tidal',
  'deezer',
  'youtube_music',
  'bandcamp',
  'soundcloud',
  'amazon_music',
];

const MAX_BADGES = 6;

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
 * @returns {string} HTML for the badge row, or ''
 */
export function renderAvailabilityBadges(availability) {
  if (!Array.isArray(availability) || availability.length === 0) return '';

  const have = new Set(availability);
  const chosen = PLATFORM_PRIORITY.filter((service) => have.has(service)).slice(
    0,
    MAX_BADGES
  );
  if (chosen.length === 0) return '';

  const squares = chosen
    .map((service) => {
      const meta = PLATFORM_BADGES[service];
      return `<span class="availability-badge" style="background-color:${meta.color}" title="${meta.label}" aria-label="${meta.label}">${badgeInner(meta)}</span>`;
    })
    .join('');

  return `<div class="album-availability">${squares}</div>`;
}
