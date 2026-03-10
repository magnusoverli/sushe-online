/**
 * Column Configuration Module
 *
 * Manages desktop album grid column visibility. Users can show/hide optional
 * columns (Country, Genre 1, Genre 2, Track, Comment, Comment 2) while
 * structural columns (Position, Cover, Album, Artist) remain always visible.
 *
 * Preferences are persisted server-side via the user settings API and applied
 * by dynamically recomputing the CSS grid-template-columns variable.
 *
 * @module column-config
 */

import { apiCall } from '../app.js';

// ── Column Definitions ──────────────────────────────────────────────────────

/**
 * Ordered definition of all desktop album grid columns.
 * Each entry describes the column's identity, display label, CSS grid width,
 * CSS class used on header/row cells, and whether the user can hide it.
 */
const COLUMN_DEFINITIONS = [
  {
    id: 'position',
    label: '',
    width: '7px',
    cellClass: 'position-cell',
    alwaysVisible: true,
  },
  {
    id: 'cover',
    label: '',
    width: '75px',
    cellClass: 'cover-cell',
    alwaysVisible: true,
  },
  {
    id: 'album',
    label: 'Album',
    width: '0.65fr',
    cellClass: 'album-cell',
    alwaysVisible: true,
  },
  {
    id: 'artist',
    label: 'Artist',
    width: '0.55fr',
    cellClass: 'artist-cell',
    alwaysVisible: true,
  },
  {
    id: 'country',
    label: 'Country',
    width: '0.45fr',
    cellClass: 'country-cell',
    alwaysVisible: false,
  },
  {
    id: 'genre_1',
    label: 'Genre 1',
    width: '0.55fr',
    cellClass: 'genre-1-cell',
    alwaysVisible: false,
  },
  {
    id: 'genre_2',
    label: 'Genre 2',
    width: '0.55fr',
    cellClass: 'genre-2-cell',
    alwaysVisible: false,
  },
  {
    id: 'track',
    label: 'Track',
    width: '0.7fr',
    cellClass: 'track-cell',
    alwaysVisible: false,
  },
  {
    id: 'comment',
    label: 'Comment',
    width: '0.75fr',
    cellClass: 'comment-cell',
    alwaysVisible: false,
  },
  {
    id: 'comment_2',
    label: 'Comment 2',
    width: '0.75fr',
    cellClass: 'comment-2-cell',
    alwaysVisible: false,
  },
];

/** Columns that can be toggled by the user. */
const TOGGLEABLE_COLUMNS = COLUMN_DEFINITIONS.filter((c) => !c.alwaysVisible);

// ── State ───────────────────────────────────────────────────────────────────

/**
 * Current visibility map.
 * Keys are column IDs from TOGGLEABLE_COLUMNS; values are booleans.
 * Missing keys or null prefs = all visible (default).
 * @type {Object|null}
 */
let currentVisibility = null;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialise from the user's persisted preferences.
 * Should be called once at app startup before the first album render.
 *
 * @param {Object|null} prefs - The columnVisibility object from window.currentUser
 */
function init(prefs) {
  currentVisibility = prefs || null;
  applyGridTemplate();
}

/**
 * Return whether a given column is currently visible.
 *
 * @param {string} columnId - Column ID (e.g. 'country', 'genre_1')
 * @returns {boolean}
 */
function isColumnVisible(columnId) {
  const def = COLUMN_DEFINITIONS.find((c) => c.id === columnId);
  if (!def) return false;
  if (def.alwaysVisible) return true;
  if (!currentVisibility) return true; // null = all visible
  return currentVisibility[columnId] !== false;
}

/**
 * Return ordered array of currently visible column definitions.
 *
 * @returns {Array<Object>}
 */
function getVisibleColumns() {
  return COLUMN_DEFINITIONS.filter((c) => isColumnVisible(c.id));
}

/**
 * Return the full ordered column definitions array.
 *
 * @returns {Array<Object>}
 */
function getAllColumns() {
  return COLUMN_DEFINITIONS;
}

/**
 * Return just the toggleable columns (for the UI dropdown).
 *
 * @returns {Array<Object>}
 */
function getToggleableColumns() {
  return TOGGLEABLE_COLUMNS;
}

/**
 * Compute the CSS grid-template-columns string for currently visible columns.
 *
 * @param {Array<Object>} [visibleCols] - Optional override; defaults to getVisibleColumns()
 * @returns {string} e.g. "7px 75px 0.65fr 0.55fr 0.7fr 0.75fr"
 */
function computeGridTemplate(visibleCols) {
  const cols = visibleCols || getVisibleColumns();
  return cols.map((c) => c.width).join(' ');
}

/**
 * Apply the current visibility to the CSS custom property so the grid
 * reflects it immediately.
 */
function applyGridTemplate() {
  const template = computeGridTemplate();
  document.documentElement.style.setProperty('--album-grid-columns', template);
}

/**
 * Toggle a single column's visibility, apply immediately, and persist.
 *
 * @param {string} columnId - Column ID to toggle
 * @returns {boolean} The new visibility state of the column
 */
function toggleColumn(columnId) {
  const def = COLUMN_DEFINITIONS.find((c) => c.id === columnId);
  if (!def || def.alwaysVisible) return true;

  if (!currentVisibility) {
    currentVisibility = {};
  }

  const newState = !isColumnVisible(columnId);
  currentVisibility[columnId] = newState;

  // Clean up: remove keys that are true (visible is default)
  if (newState === true) {
    delete currentVisibility[columnId];
  }

  // If all are now visible, reset to null for clean storage
  const hasHidden = Object.values(currentVisibility).some((v) => v === false);
  if (!hasHidden) {
    currentVisibility = null;
  }

  // Sync to window.currentUser
  if (window.currentUser) {
    window.currentUser.columnVisibility = currentVisibility;
  }

  applyGridTemplate();
  saveColumnVisibility();

  // Notify listeners that column visibility changed
  window.dispatchEvent(new CustomEvent('columnvisibilitychange'));

  return newState;
}

/**
 * Set visibility for all toggleable columns at once.
 *
 * @param {boolean} visible - true = show all, false = hide all
 */
function setAllColumns(visible) {
  if (visible) {
    currentVisibility = null;
  } else {
    currentVisibility = {};
    for (const col of TOGGLEABLE_COLUMNS) {
      currentVisibility[col.id] = false;
    }
  }

  if (window.currentUser) {
    window.currentUser.columnVisibility = currentVisibility;
  }

  applyGridTemplate();
  saveColumnVisibility();

  // Notify listeners that column visibility changed
  window.dispatchEvent(new CustomEvent('columnvisibilitychange'));
}

/**
 * Return the current visibility preferences object (for settings drawer sync).
 *
 * @returns {Object|null}
 */
function getVisibilityPrefs() {
  return currentVisibility;
}

// ── Persistence ─────────────────────────────────────────────────────────────

/** Debounce timer for save requests. */
let saveTimer = null;

/**
 * Persist the current column visibility to the server.
 * Debounced to avoid rapid-fire API calls when toggling multiple columns.
 */
function saveColumnVisibility() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await apiCall('/settings/update-column-visibility', {
        method: 'POST',
        body: JSON.stringify({ columnVisibility: currentVisibility }),
      });
    } catch {
      // Silent failure — the local state is already applied.
      // On next page load the server's last-saved state will be used.
    }
  }, 500);
}

// ── Exports ─────────────────────────────────────────────────────────────────

export {
  COLUMN_DEFINITIONS,
  TOGGLEABLE_COLUMNS,
  init,
  isColumnVisible,
  getVisibleColumns,
  getAllColumns,
  getToggleableColumns,
  computeGridTemplate,
  applyGridTemplate,
  toggleColumn,
  setAllColumns,
  getVisibilityPrefs,
};
