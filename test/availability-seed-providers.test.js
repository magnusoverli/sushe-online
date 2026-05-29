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
              },
            ],
          }),
        };
      },
    });

    const result = await providers.acquireSeed(album, null);
    assert.strictEqual(result.kind, 'itunes');
    assert.strictEqual(result.seed.id, 1655432387);
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
});
