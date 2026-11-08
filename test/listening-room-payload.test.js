const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildListeningRoomPayload,
} = require('../utils/listening-room-payload');

const expiry = '2026-11-15T13:32:00.000Z';
const item = (overrides = {}) => ({
  artist: 'Artist',
  album: 'Album',
  primary_track: 'Pick',
  ...overrides,
});
const build = (items, list = { name: 'Best of 2025', year: 2025 }) =>
  buildListeningRoomPayload({ list, items }, expiry);

describe('Listening Room v1 payload', () => {
  it('uses one primary pick and falls back to secondary only when primary is empty', () => {
    const { songs } = build([
      item({ primary_track: 'First', secondary_track: 'Second' }),
      item({ primary_track: '', secondary_track: 'Second' }),
      item({ primary_track: null, secondary_track: 'Third' }),
      item({ primary_track: '#9', secondary_track: 'Never used' }),
    ]);
    assert.deepEqual(
      songs.map((song) => song.title),
      ['First', 'Second', 'Third']
    );
  });

  it('excludes disqualified first, counts missing picks, and keeps display ranks', () => {
    const payload = build([
      item({ is_disqualified: true }),
      item({ is_disqualified: true, primary_track: null }),
      item({ primary_track: null }),
      item(),
      item({ primary_track: '#99' }),
      item(),
    ]);
    assert.deepEqual(payload.leftOut, { noPick: 2, disqualified: 2 });
    assert.deepEqual(
      payload.songs.map((song) => song.rank),
      [4, 6]
    );
  });

  it('resolves exact names before positional picks and rounds milliseconds to seconds', () => {
    const tracks = [
      { name: '#2', length: 245500 },
      { title: 'Other', length: null },
    ];
    const { songs } = build([
      item({ primary_track: '#2', tracks }),
      item({ primary_track: '2', tracks }),
      item({ primary_track: '#1', tracks }),
      item({ primary_track: 'String', tracks: ['String'] }),
    ]);
    assert.deepEqual(
      songs.map(({ title, trackNumber, duration }) => ({
        title,
        trackNumber,
        duration,
      })),
      [
        { title: '#2', trackNumber: 1, duration: 246 },
        { title: 'Other', trackNumber: 2, duration: null },
        { title: '#2', trackNumber: 1, duration: 246 },
        { title: 'String', trackNumber: 1, duration: null },
      ]
    );
  });

  it('shares unmatched plain titles exactly as typed with or without a tracklist', () => {
    const { songs } = build([
      item({ primary_track: '  My title  ', tracks: ['Other'] }),
      item({ tracks: null }),
    ]);
    assert.deepEqual(
      songs.map(({ title, trackNumber, duration }) => ({
        title,
        trackNumber,
        duration,
      })),
      [
        { title: '  My title  ', trackNumber: null, duration: null },
        { title: 'Pick', trackNumber: null, duration: null },
      ]
    );
  });

  it('excludes unresolved numeric references including zero and out of range', () => {
    const payload = build(
      ['#0', '#5', '5', '#123'].map((primary_track) =>
        item({ primary_track, tracks: ['Only'] })
      )
    );
    assert.deepEqual(payload.leftOut, { noPick: 4, disqualified: 0 });
    assert.deepEqual(payload.songs, []);
  });

  it('only exposes contract fields, all known https services and no private data', () => {
    const services = [
      'spotify',
      'tidal',
      'qobuz',
      'itunes',
      'bandcamp',
      'soundcloud',
      'youtube',
    ];
    const payload = build(
      [
        item({
          _id: 'private-item-id',
          comments: 'private comment',
          username: 'private user',
          email: 'private@example.com',
          secondary_track: 'private second',
          availability_links: [
            ...services.map((service) => ({
              service,
              url: `https://example.com/${service}`,
              private: 'secret',
            })),
            { service: 'spotify', url: 'javascript:alert(1)' },
            { service: 'tidal', url: 'http://example.com/album' },
            { service: 'lastfm', url: 'https://example.com/album' },
          ],
        }),
      ],
      {
        name: 'Public list',
        year: null,
        _id: 'private list',
        user_id: 'private owner',
      }
    );
    assert.deepEqual(payload, {
      format: 'sushe-listening-room',
      version: 1,
      list: { name: 'Public list', year: null },
      expiresAt: expiry,
      leftOut: { noPick: 0, disqualified: 0 },
      songs: [
        {
          rank: 1,
          artist: 'Artist',
          album: 'Album',
          title: 'Pick',
          trackNumber: null,
          duration: null,
          albumLinks: services.map((service) => ({
            service,
            url: `https://example.com/${service}`,
          })),
        },
      ],
    });
    assert.ok(!JSON.stringify(payload).includes('private'));
  });

  it('caps at the first 500 usable songs while still counting all exclusions', () => {
    const payload = build([
      ...Array.from({ length: 502 }, () => item()),
      item({ is_disqualified: true }),
      item({ primary_track: null }),
    ]);
    assert.equal(payload.songs.length, 500);
    assert.equal(payload.songs[499].rank, 500);
    assert.deepEqual(payload.leftOut, { noPick: 1, disqualified: 1 });
  });

  it('enforces UTF-8 byte, string and link bounds', () => {
    const long = '🎵'.repeat(1000);
    const payload = build(
      Array.from({ length: 501 }, () =>
        item({
          artist: long,
          album: long,
          primary_track: long,
          availability_links: Array.from({ length: 12 }, () => ({
            service: 'spotify',
            url: `https://example.com/${long}`,
          })),
        })
      ),
      { name: long, year: 2025 }
    );
    assert.ok(Buffer.byteLength(JSON.stringify(payload)) < 512 * 1024);
    assert.equal(Array.from(payload.list.name).length, 500);
    assert.equal(payload.songs[0].albumLinks.length, 10);
    assert.equal(Array.from(payload.songs[0].title).length, 500);
  });

  it('handles an empty list without inventing songs', () => {
    assert.deepEqual(build([]).songs, []);
  });
});
