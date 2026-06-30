const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

const {
  createAlbumSearchService,
  tokenize,
  resolveColumns,
  escapeLike,
  clampLimit,
  extractYear,
} = require('../services/search/album-search-service');
const { createMockDb } = require('./helpers');

/**
 * Build a service whose db.raw records its calls and returns a fixed row set.
 */
function createCapturingService(rows = []) {
  const calls = [];
  const rawFn = mock.fn(async (sql, params, opts) => {
    calls.push({ sql, params, opts });
    return { rows, rowCount: rows.length };
  });
  const db = createMockDb(rawFn);
  const service = createAlbumSearchService({ db });
  return { service, calls };
}

describe('album-search-service helpers', () => {
  it('tokenize splits on whitespace and drops empties', () => {
    assert.deepStrictEqual(tokenize('  radiohead   kid  '), [
      'radiohead',
      'kid',
    ]);
    assert.deepStrictEqual(tokenize(''), []);
    assert.deepStrictEqual(tokenize('   '), []);
  });

  it('tokenize caps the number of tokens', () => {
    const many = Array.from({ length: 20 }, (_, i) => `t${i}`).join(' ');
    assert.strictEqual(tokenize(many).length, 8);
  });

  it('escapeLike escapes LIKE wildcards literally', () => {
    assert.strictEqual(escapeLike('50%'), '50\\%');
    assert.strictEqual(escapeLike('a_b'), 'a\\_b');
    assert.strictEqual(escapeLike('back\\slash'), 'back\\\\slash');
    assert.strictEqual(escapeLike('plain'), 'plain');
  });

  it('resolveColumns always includes artist + album', () => {
    assert.deepStrictEqual(resolveColumns([]), ['a.artist', 'a.album']);
  });

  it('resolveColumns adds opted-in field groups', () => {
    const columns = resolveColumns(['meta', 'notes', 'tracks']);
    assert.ok(columns.includes('a.artist'));
    assert.ok(columns.includes('a.album'));
    assert.ok(columns.includes('a.genre_1'));
    assert.ok(columns.includes('li.comments'));
    assert.ok(columns.includes('a.tracks::text'));
  });

  it('resolveColumns ignores unknown field groups', () => {
    assert.deepStrictEqual(resolveColumns(['bogus']), ['a.artist', 'a.album']);
  });

  it('clampLimit applies defaults and bounds', () => {
    assert.strictEqual(clampLimit(undefined), 25);
    assert.strictEqual(clampLimit('0'), 25);
    assert.strictEqual(clampLimit('-5'), 25);
    assert.strictEqual(clampLimit('10'), 10);
    assert.strictEqual(clampLimit('9999'), 50);
  });

  it('extractYear pulls a 4-digit year', () => {
    assert.strictEqual(extractYear('1997-06-16'), '1997');
    assert.strictEqual(extractYear('2001'), '2001');
    assert.strictEqual(extractYear(''), '');
    assert.strictEqual(extractYear(null), '');
  });
});

describe('album-search-service searchUserAlbums', () => {
  it('returns empty without hitting the db when the query is blank', async () => {
    const { service, calls } = createCapturingService();
    const result = await service.searchUserAlbums({
      userId: 'user1',
      query: '   ',
    });
    assert.deepStrictEqual(result, { results: [], total: 0, truncated: false });
    assert.strictEqual(calls.length, 0);
  });

  it('returns empty without hitting the db when userId is missing', async () => {
    const { service, calls } = createCapturingService();
    const result = await service.searchUserAlbums({ query: 'radiohead' });
    assert.deepStrictEqual(result, { results: [], total: 0, truncated: false });
    assert.strictEqual(calls.length, 0);
  });

  it('scopes the query to the user and searches artist + album by default', async () => {
    const { service, calls } = createCapturingService();
    await service.searchUserAlbums({ userId: 'user1', query: 'kid' });

    assert.strictEqual(calls.length, 1);
    const { sql, params } = calls[0];
    assert.match(sql, /WHERE l\.user_id = \$1/);
    assert.match(sql, /a\.artist ILIKE \$2 OR a\.album ILIKE \$2/);
    // Default fields must NOT reach into notes/tracks columns.
    assert.doesNotMatch(sql, /li\.comments/);
    assert.doesNotMatch(sql, /tracks::text/);
    assert.strictEqual(params[0], 'user1');
    assert.strictEqual(params[1], '%kid%');
    // Last param is the limit (default 25) + 1 for truncation detection.
    assert.strictEqual(params[params.length - 1], 26);
  });

  it('ANDs one clause per token with its own parameter', async () => {
    const { service, calls } = createCapturingService();
    await service.searchUserAlbums({
      userId: 'user1',
      query: 'radiohead kid',
    });
    const { sql, params } = calls[0];
    assert.match(sql, /\$2.*\) AND \(.*\$3/s);
    assert.strictEqual(params[1], '%radiohead%');
    assert.strictEqual(params[2], '%kid%');
  });

  it('searches optional field columns when requested', async () => {
    const { service, calls } = createCapturingService();
    await service.searchUserAlbums({
      userId: 'user1',
      query: 'doom',
      fields: ['meta', 'notes', 'tracks'],
    });
    const { sql } = calls[0];
    assert.match(sql, /a\.genre_1 ILIKE/);
    assert.match(sql, /li\.comments ILIKE/);
    assert.match(sql, /a\.tracks::text ILIKE/);
  });

  it('escapes LIKE wildcards in the search term', async () => {
    const { service, calls } = createCapturingService();
    await service.searchUserAlbums({ userId: 'user1', query: '50%' });
    assert.strictEqual(calls[0].params[1], '%50\\%%');
  });

  it('maps rows to a camelCase shape with an extracted year', async () => {
    const { service } = createCapturingService([
      {
        album_id: 'alb1',
        artist: 'Radiohead',
        album: 'Kid A',
        release_date: '2000-10-02',
        list_id: 'list1',
        list_name: 'Best of 2000',
        position: 3,
      },
    ]);
    const result = await service.searchUserAlbums({
      userId: 'user1',
      query: 'kid',
    });
    assert.deepStrictEqual(result.results[0], {
      albumId: 'alb1',
      artist: 'Radiohead',
      album: 'Kid A',
      year: '2000',
      listId: 'list1',
      listName: 'Best of 2000',
      position: 3,
    });
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.truncated, false);
  });

  it('searches optional field columns in a fixed order regardless of selection order', async () => {
    const { service, calls } = createCapturingService();
    await service.searchUserAlbums({
      userId: 'user1',
      query: 'doom',
      fields: ['tracks', 'notes', 'meta'], // reversed from canonical order
    });
    // meta columns precede notes columns precede tracks columns in the SQL,
    // matching OPTIONAL_COLUMNS key order — not the caller's argument order.
    const { sql } = calls[0];
    assert.ok(sql.indexOf('a.genre_1') < sql.indexOf('li.comments'));
    assert.ok(sql.indexOf('li.comments') < sql.indexOf('a.tracks::text'));
  });

  it('flags truncation and trims to the requested limit', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      album_id: `alb${i}`,
      artist: 'A',
      album: `Album ${i}`,
      release_date: '1999',
      list_id: 'list1',
      list_name: 'List',
      position: i,
    }));
    const { service } = createCapturingService(rows);
    const result = await service.searchUserAlbums({
      userId: 'user1',
      query: 'album',
      limit: 2,
    });
    assert.strictEqual(result.truncated, true);
    assert.strictEqual(result.results.length, 2);
    assert.strictEqual(result.total, 2);
  });
});

describe('album-search-service prepared-statement naming', () => {
  // pg binds a prepared-statement name to its SQL text per connection and
  // rejects reuse of the name with different text. The query's SQL varies with
  // both the selected fields and the token count, so the name must vary with
  // the SQL — otherwise reused pooled connections throw "prepared statements
  // must be unique" and the search 500s.
  async function nameFor(args) {
    const { service, calls } = createCapturingService();
    await service.searchUserAlbums({ userId: 'user1', ...args });
    return calls[0].opts.name;
  }

  it('uses a different statement name when the field set changes', async () => {
    const base = await nameFor({ query: 'doom' });
    const meta = await nameFor({ query: 'doom', fields: ['meta'] });
    const notes = await nameFor({ query: 'doom', fields: ['notes'] });
    assert.notStrictEqual(base, meta);
    assert.notStrictEqual(base, notes);
    assert.notStrictEqual(meta, notes);
  });

  it('uses a different statement name when the token count changes', async () => {
    const one = await nameFor({ query: 'doom' });
    const two = await nameFor({ query: 'doom metal' });
    assert.notStrictEqual(one, two);
  });

  it('reuses the same statement name for identical SQL (plan-cache friendly)', async () => {
    const a = await nameFor({ query: 'doom', fields: ['meta'] });
    const b = await nameFor({ query: 'sludge', fields: ['meta'] });
    // Same columns + same token count => same SQL text => same name.
    assert.strictEqual(a, b);
  });

  it('is insensitive to the order fields were selected in', async () => {
    const forward = await nameFor({ query: 'doom', fields: ['meta', 'notes'] });
    const reverse = await nameFor({ query: 'doom', fields: ['notes', 'meta'] });
    assert.strictEqual(forward, reverse);
  });
});
