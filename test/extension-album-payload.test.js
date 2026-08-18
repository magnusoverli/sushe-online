const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

describe('extension album payload compatibility', () => {
  beforeEach(() => {
    delete globalThis.AlbumApiService;
    delete require.cache[
      require.resolve('../browser-extension/album-api-service.js')
    ];
    require('../browser-extension/album-api-service.js');
  });

  it('retains legacy fields and carries sourceObservation', () => {
    const observation = {
      schemaVersion: 1,
      identity: {
        numericId: 123,
        canonicalUrl:
          'https://rateyourmusic.com/release/album/talk-talk/spirit-of-eden/',
        canonicalPath: '/release/album/talk-talk/spirit-of-eden/',
        artist: 'Talk Talk',
        title: 'Spirit of Eden',
      },
      platformLinks: [
        { service: 'spotify', url: 'https://open.spotify.com/album/id' },
      ],
      taxonomy: {
        complete: true,
        primaryGenres: ['Art Rock'],
        secondaryGenres: ['Post-Rock'],
        descriptors: ['atmospheric'],
        languages: ['English'],
        scenes: ['Canterbury Scene'],
        movements: ['New Wave'],
        releaseType: 'Album',
        labels: [{ name: 'Example Records', catalogNumber: 'EX-001' }],
        credits: [{ name: 'Jane Doe', roles: ['Vocals'] }],
        sourceUrl:
          'https://rateyourmusic.com/release/album/talk-talk/spirit-of-eden/',
        extractorVersion: 'test/1',
        capturedAt: '2026-08-17T12:00:00.000Z',
      },
      ignored: 'not part of schema v1',
    };
    const service = globalThis.AlbumApiService.createAlbumApiService({
      constants: { API: {} },
    });
    const payload = service.buildAlbumPayload(
      {
        artist: 'Talk Talk',
        album: 'Spirit of Eden',
        genre_1: 'Art Rock',
        genre_2: 'Post-Rock',
        sourceObservation: observation,
      },
      { id: 'mbid', 'first-release-date': '1988-09-16' },
      'GB'
    );

    assert.deepStrictEqual(payload, {
      artist: 'Talk Talk',
      album: 'Spirit of Eden',
      album_id: 'mbid',
      release_date: '1988-09-16',
      country: 'GB',
      genre_1: 'Art Rock',
      genre_2: 'Post-Rock',
      sourceObservation: {
        schemaVersion: 1,
        identity: { ...observation.identity, numericId: '123' },
        platformLinks: observation.platformLinks,
        taxonomy: observation.taxonomy,
      },
      comments: '',
      tracks: null,
      primary_track: null,
      secondary_track: null,
    });
  });

  it('keeps old album data callers compatible', () => {
    const service = globalThis.AlbumApiService.createAlbumApiService({
      constants: { API: {} },
    });
    const payload = service.buildAlbumPayload(
      { artist: 'Artist', album: 'Album' },
      {},
      ''
    );

    assert.strictEqual(payload.genre_1, '');
    assert.strictEqual(payload.genre_2, '');
    assert.strictEqual('sourceObservation' in payload, false);
  });

  it('sends delayed observations to the album endpoint', async () => {
    const fetchWithTimeout = mock.fn(async () => ({ ok: true }));
    const service = globalThis.AlbumApiService.createAlbumApiService({
      constants: { API: { ALBUMS: '/api/albums' } },
      fetchWithTimeout,
      getAuthHeaders: () => ({ Authorization: 'Bearer token' }),
    });
    const observation = { schemaVersion: 1 };

    await service.updateSourceObservation(
      'https://sushe.test',
      'album/1',
      observation
    );

    assert.deepStrictEqual(fetchWithTimeout.mock.calls[0].arguments, [
      'https://sushe.test/api/albums/album%2F1/source-observation',
      {
        method: 'PUT',
        headers: { Authorization: 'Bearer token' },
        body: JSON.stringify({ sourceObservation: observation }),
      },
      15000,
    ]);
  });
});
