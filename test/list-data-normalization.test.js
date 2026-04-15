const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

describe('list-data-normalization module', () => {
  let normalizeAlbumRecord;
  let normalizeAlbumRecords;
  let createDefaultListEntry;
  let normalizeListsMap;

  beforeEach(async () => {
    const module = await import('../src/js/modules/list-data-normalization.js');
    normalizeAlbumRecord = module.normalizeAlbumRecord;
    normalizeAlbumRecords = module.normalizeAlbumRecords;
    createDefaultListEntry = module.createDefaultListEntry;
    normalizeListsMap = module.normalizeListsMap;
  });

  it('normalizes legacy album fields into canonical keys', () => {
    const legacyAlbum = {
      albumId: 'abc',
      comment: 'legacy comment',
      genre: 'Rock',
      track_pick: 'Song 1',
      track_picks: { secondary: 'Song 2' },
    };

    const result = normalizeAlbumRecord(legacyAlbum);

    assert.strictEqual(result.changed, true);
    assert.deepStrictEqual(result.album, {
      albumId: 'abc',
      album_id: 'abc',
      comment: 'legacy comment',
      comments: 'legacy comment',
      genre: 'Rock',
      genre_1: 'Rock',
      track_pick: 'Song 1',
      track_picks: { secondary: 'Song 2' },
      primary_track: 'Song 1',
      secondary_track: 'Song 2',
    });
  });

  it('returns original album array reference when no normalization is needed', () => {
    const albums = [{ album_id: 'a1', comments: 'ok', primary_track: 'p1' }];

    const normalized = normalizeAlbumRecords(albums);

    assert.strictEqual(normalized, albums);
  });

  it('creates default list entry with normalized data', () => {
    const entry = createDefaultListEntry('list-1', [
      { albumId: 'a1', comment: 'x', genre: 'Jazz' },
    ]);

    assert.strictEqual(entry._id, 'list-1');
    assert.strictEqual(entry.name, 'Unknown');
    assert.strictEqual(entry.count, 1);
    assert.strictEqual(entry._data[0].album_id, 'a1');
    assert.strictEqual(entry._data[0].comments, 'x');
    assert.strictEqual(entry._data[0].genre_1, 'Jazz');
  });

  it('normalizes mixed list map entries', () => {
    const input = {
      'list-1': [{ albumId: 'a1' }],
      'list-2': {
        _id: 'list-2',
        _data: [{ albumId: 'a2', comment: 'hello' }],
      },
    };

    const normalized = normalizeListsMap(input);

    assert.strictEqual(Array.isArray(normalized['list-1']._data), true);
    assert.strictEqual(normalized['list-1']._data[0].album_id, 'a1');
    assert.strictEqual(normalized['list-2']._data[0].album_id, 'a2');
    assert.strictEqual(normalized['list-2']._data[0].comments, 'hello');
  });
});
