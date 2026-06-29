/**
 * Album Search Service
 *
 * Case-insensitive substring search over the albums in a single user's own
 * lists. Returns plain JSON rows with list attribution so the same service can
 * back the desktop header search today and any future client (mobile, native,
 * browser extension) without reshaping. Business logic lives here; the route
 * (routes/api/search.js) stays a thin HTTP adapter.
 *
 * Matching rules (kept in sync with the client field selector):
 *   - artist + album title are always searched.
 *   - Optional field groups the caller can opt into:
 *       meta   -> release date, country, genre tags
 *       notes  -> the user's per-list comments
 *       tracks -> track listing + the user's track picks
 *   - Multi-word queries are AND-of-tokens: every whitespace-separated token
 *     must match somewhere in the selected fields (tokens may match different
 *     fields), which is how "radiohead kid" finds Radiohead's "Kid A".
 */

const { ensureDb } = require('../../db/postgres');

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const MAX_TOKENS = 8;
const MAX_TOKEN_LENGTH = 64;

// artist + album are always searched.
const BASE_COLUMNS = ['a.artist', 'a.album'];

// Optional field groups -> the SQL column expressions they search. release_date
// and tracks are cast to text so a substring match works regardless of the
// underlying column type (date / jsonb).
const OPTIONAL_COLUMNS = {
  meta: ['a.release_date::text', 'a.country', 'a.genre_1', 'a.genre_2'],
  notes: ['li.comments', 'li.comments_2'],
  tracks: ['a.tracks::text', 'li.primary_track', 'li.secondary_track'],
};

/**
 * Escape LIKE/ILIKE wildcards so user input is matched literally (a typed "%"
 * or "_" should be a character to find, not a pattern). Postgres treats "\" as
 * the default escape character, so escaped specials need no explicit ESCAPE.
 */
function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Split a query into bounded, non-empty whitespace tokens. */
function tokenize(query) {
  return String(query || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_TOKENS)
    .map((token) => token.slice(0, MAX_TOKEN_LENGTH));
}

/** Resolve the set of SQL columns to search from the requested field groups. */
function resolveColumns(fields) {
  const columns = [...BASE_COLUMNS];
  const requested = Array.isArray(fields) ? fields : [];
  for (const key of requested) {
    if (OPTIONAL_COLUMNS[key]) columns.push(...OPTIONAL_COLUMNS[key]);
  }
  return columns;
}

function clampLimit(limit) {
  const parsed = Number.parseInt(limit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

/** Pull a 4-digit year out of a release date string for compact display. */
function extractYear(releaseDate) {
  if (!releaseDate) return '';
  const match = String(releaseDate).match(/\d{4}/);
  return match ? match[0] : '';
}

function createAlbumSearchService(deps = {}) {
  const db = ensureDb(deps.db, 'album-search-service');

  /**
   * @param {Object} args
   * @param {string} args.userId   Owner whose lists are searched.
   * @param {string} args.query    Raw search text.
   * @param {string[]} [args.fields] Optional field groups (meta|notes|tracks).
   * @param {number|string} [args.limit] Max results (clamped to MAX_LIMIT).
   * @returns {Promise<{results: Array, total: number, truncated: boolean}>}
   */
  async function searchUserAlbums({ userId, query, fields, limit } = {}) {
    const tokens = tokenize(query);
    const cappedLimit = clampLimit(limit);

    // An empty query must never fall through to an unfiltered "return every
    // album" scan.
    if (!userId || tokens.length === 0) {
      return { results: [], total: 0, truncated: false };
    }

    const columns = resolveColumns(fields);
    const params = [userId];

    // One parameter per token (its escaped %pattern%); within a token, OR the
    // pattern across every searched column; AND the per-token clauses together.
    const tokenClauses = tokens.map((token) => {
      params.push(`%${escapeLike(token)}%`);
      const placeholder = `$${params.length}`;
      const ors = columns.map((col) => `${col} ILIKE ${placeholder}`);
      return `(${ors.join(' OR ')})`;
    });

    // Fetch one extra row to detect truncation without a COUNT(*).
    params.push(cappedLimit + 1);
    const limitPlaceholder = `$${params.length}`;

    const sql = `
      SELECT a.album_id,
             a.artist,
             a.album,
             a.release_date,
             l._id  AS list_id,
             l.name AS list_name,
             li.position
      FROM lists l
      JOIN list_items li ON li.list_id = l._id
      JOIN albums a ON a.album_id = li.album_id
      WHERE l.user_id = $1
        AND ${tokenClauses.join(' AND ')}
      ORDER BY a.artist ASC, a.album ASC, l.name ASC, li.position ASC
      LIMIT ${limitPlaceholder}`;

    const result = await db.raw(sql, params, {
      name: 'album-search-user-albums',
      retryable: true,
    });

    const rows = result.rows || [];
    const truncated = rows.length > cappedLimit;
    const visible = truncated ? rows.slice(0, cappedLimit) : rows;

    return {
      results: visible.map((row) => ({
        albumId: row.album_id,
        artist: row.artist || '',
        album: row.album || '',
        year: extractYear(row.release_date),
        listId: row.list_id,
        listName: row.list_name || '',
        position: row.position,
      })),
      total: visible.length,
      truncated,
    };
  }

  return { searchUserAlbums };
}

module.exports = {
  createAlbumSearchService,
  // Exported for unit tests.
  tokenize,
  resolveColumns,
  escapeLike,
  clampLimit,
  extractYear,
};
