const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  findUserAlbumMatch,
  refreshAlbumPlaycount,
} = require('../services/playcount-engine');

const USER_ALBUMS = [
  {
    name: "Infinitude's Passage",
    artist: { name: 'Aenigmatum' },
    playcount: '19',
  },
  {
    name: 'Caminhos de Água',
    artist: { name: 'Kaatayra' },
    playcount: '12',
  },
  {
    name: 'Brenndar Rustir og Fudrandi Fjorur',
    artist: { name: 'Forsman' },
    playcount: '1',
  },
];

describe('findUserAlbumMatch', () => {
  it('matches Last.fm ASCII artist aliases', () => {
    const match = findUserAlbumMatch(
      { artist: 'Ænigmatum', album: "Infinitude's Passage" },
      USER_ALBUMS
    );

    assert.strictEqual(match.playcount, '19');
  });

  it('matches a misspelled artist and diacritic-free album title', () => {
    const match = findUserAlbumMatch(
      { artist: 'Kaataira', album: 'Caminhos De Agua' },
      USER_ALBUMS
    );

    assert.strictEqual(match.playcount, '12');
  });

  it('matches normalized punctuation and a localized conjunction', () => {
    const match = findUserAlbumMatch(
      {
        artist: 'Forsmán',
        album: 'Brenndar rústir & fuðrandi fjörur',
      },
      USER_ALBUMS
    );

    assert.strictEqual(match.playcount, '1');
  });

  it('rejects the same album title by a different artist', () => {
    const match = findUserAlbumMatch(
      { artist: 'Unrelated Artist', album: 'Caminhos De Agua' },
      USER_ALBUMS
    );

    assert.strictEqual(match, null);
  });
});

describe('refreshAlbumPlaycount', () => {
  it('writes an authoritative user-library count without an album metadata lookup', async () => {
    const queries = [];
    const db = {
      raw: async (sql, params) => {
        queries.push({ sql, params });
        return { rows: [], rowCount: 1 };
      },
    };
    const logger = { debug() {}, info() {}, warn() {}, error() {} };

    const result = await refreshAlbumPlaycount(
      db,
      logger,
      'user-1',
      'magnus_overli',
      {
        artist: 'Forsmán',
        album: 'Brenndar rústir & fuðrandi fjörur',
      },
      { userAlbums: USER_ALBUMS }
    );

    assert.deepStrictEqual(result, { playcount: 1, status: 'success' });
    assert.strictEqual(queries.length, 1);
    assert.match(queries[0].sql, /INSERT INTO user_album_stats/);
    assert.strictEqual(queries[0].params[5], 1);
  });
});
