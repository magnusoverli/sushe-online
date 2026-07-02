/**
 * Single color contract for the mobile album-card rank badge.
 *
 * Both the initial render (getPositionBadgeHtml) and the drag-reorder recolor
 * (updatePositionNumbers) read colors from here, so a reordered badge never
 * keeps a stale rank color. The badge is styled with inline styles, so recolor
 * must set style.borderColor / style.boxShadow (not Tailwind border-* classes).
 *
 * Values are gold (1st), silver (2nd), bronze (3rd), gray (rest).
 */
export const POSITION_BADGE_COLORS = {
  1: {
    border: 'var(--medal-gold)',
    shadow: 'rgba(255,215,0,1.0)',
    size: '8px',
  },
  2: {
    border: 'var(--medal-silver)',
    shadow: 'rgba(192,192,192,1.0)',
    size: '8px',
  },
  3: {
    border: 'var(--medal-bronze)',
    shadow: 'rgba(205,127,50,1.0)',
    size: '8px',
  },
  default: { border: '#6b7280', shadow: 'rgba(255,255,255,0.25)', size: '5px' },
};

/**
 * @param {number|null} position - 1-based rank
 * @returns {{ border: string, shadow: string, size: string }}
 */
export function getPositionBadgeColor(position) {
  return POSITION_BADGE_COLORS[position] || POSITION_BADGE_COLORS.default;
}
