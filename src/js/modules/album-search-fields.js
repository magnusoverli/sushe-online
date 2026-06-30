/**
 * Album-search field groups — the single source of truth shared by the desktop
 * options popover and the mobile filter sheet.
 *
 * Artist + album title are always searched server-side; these are the OPTIONAL
 * groups a user can opt into. Keys MUST match OPTIONAL_FIELDS in
 * routes/api/search.js. The selection persists to localStorage under one key so
 * the desktop and mobile UIs stay in sync.
 */

export const FIELDS_STORAGE_KEY = 'albumSearch.fields';

export const OPTIONAL_FIELDS = [
  { key: 'meta', label: 'Year, genre & country' },
  { key: 'notes', label: 'Notes & comments' },
  { key: 'tracks', label: 'Track names' },
];

const VALID_KEYS = new Set(OPTIONAL_FIELDS.map((field) => field.key));

/** Read the persisted field selection, dropping anything unrecognized. */
export function loadFields(storage) {
  try {
    const raw = storage?.getItem(FIELDS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((key) => VALID_KEYS.has(key));
  } catch {
    return [];
  }
}

/** Persist the field selection (best-effort; ignores quota/disabled storage). */
export function saveFields(storage, fields) {
  try {
    storage?.setItem(FIELDS_STORAGE_KEY, JSON.stringify(fields));
  } catch {
    /* ignore quota / disabled storage */
  }
}
