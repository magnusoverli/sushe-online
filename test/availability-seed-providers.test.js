const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  createSeedProviders,
} = require('../services/availability/seed-providers');
const { createMockLogger } = require('./helpers');

const album = { albumId: 'alb-1', artist: 'Metallica', album: '72 Seasons' };

function eis(mapping) {
  return {
    getAlbumServiceMapping: async (service) =>
      service === 'spotify' ? mapping : null,
  };
}

describe('availability/seed-providers', () => {
  it('prefers an existing Spotify mapping (no network)', async () => {
    const providers = createSeedProviders({
      logger: createMockLogger(),
      externalIdentityService: eis({ external_album_id: 'sp123' }),
      fetch: async () => {
        throw new Error('should not search');
      },
    });

    const result = await providers.acquireSeed(album, 'https://mb-seed');
    assert.strictEqual(result.kind, 'existing');
    assert.deepStrictEqual(result.seed, {
      platform: 'spotify',
      type: 'album',
      id: 'sp123',
    });
  });

  it('uses the MusicBrainz seed url when no mapping exists', async () => {
    const providers = createSeedProviders({
      logger: createMockLogger(),
      externalIdentityService: eis(null),
      fetch: async () => {
        throw new Error('should not search');
      },
    });

    const result = await providers.acquireSeed(
      album,
      'https://music.apple.com/x'
    );
    assert.strictEqual(result.kind, 'musicbrainz');
    assert.deepStrictEqual(result.seed, { url: 'https://music.apple.com/x' });
  });

  it('falls through to a confident iTunes search seed', async () => {
    const providers = createSeedProviders({
      logger: createMockLogger(),
      externalIdentityService: eis(null),
      fetch: async (url) => {
        assert.ok(url.includes('itunes.apple.com/search'));
        return {
          ok: true,
          json: async () => ({
            results: [
              {
                artistName: 'Metallica',
                collectionName: '72 Seasons',
                collectionId: 1655432387,
                collectionViewUrl:
                  'https://music.apple.com/us/album/72-seasons/1655432387',
              },
            ],
          }),
        };
      },
    });

    const result = await providers.acquireSeed(album, null);
    assert.strictEqual(result.kind, 'itunes');
    assert.strictEqual(result.seed.id, 1655432387);
    assert.deepStrictEqual(result.directLink, {
      service: 'itunes',
      url: 'https://music.apple.com/us/album/72-seasons/1655432387',
      confidence: result.confidence,
    });
  });

  it('rejects a low-confidence search match and yields no seed', async () => {
    const providers = createSeedProviders({
      logger: createMockLogger(),
      externalIdentityService: eis(null),
      fetch: async (url) => {
        const body = url.includes('itunes')
          ? {
              results: [
                {
                  artistName: 'Nope',
                  collectionName: 'Different',
                  collectionId: 1,
                },
              ],
            }
          : { data: [{ artist: { name: 'Nope' }, title: 'Different', id: 2 }] };
        return { ok: true, json: async () => body };
      },
    });

    const result = await providers.acquireSeed(album, null);
    assert.strictEqual(result, null);
  });

  it('bounds a stalled iTunes seed lookup', async () => {
    const providers = createSeedProviders({
      logger: createMockLogger(),
      externalIdentityService: eis(null),
      itunesTimeoutMs: 1,
      fetch: async (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });

    assert.strictEqual(await providers.acquireIndependentSeed(album), null);
  });

  it('keeps the timeout active while reading the iTunes response body', async () => {
    const providers = createSeedProviders({
      logger: createMockLogger(),
      externalIdentityService: eis(null),
      itunesTimeoutMs: 1,
      fetch: async (_url, { signal }) => ({
        ok: true,
        json: () =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () =>
              reject(new Error('body aborted'))
            );
          }),
      }),
    });

    assert.strictEqual(await providers.acquireIndependentSeed(album), null);
  });
});
