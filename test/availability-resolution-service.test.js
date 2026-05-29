const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const {
  createAvailabilityResolutionService,
  mergeLinks,
} = require('../services/availability-resolution-service');
const { createMockLogger } = require('./helpers');

const album = { albumId: 'alb-1', artist: 'Metallica', album: '72 Seasons' };

function build({ seed, odesli, mb }) {
  const upsert = mock.fn(async () => {});
  const service = createAvailabilityResolutionService({
    logger: createMockLogger(),
    externalIdentityService: { upsertAlbumServiceMapping: upsert },
    seedProviders: { acquireSeed: async () => seed },
    odesliClient: {
      fetchLinksBySeed: async () => {
        if (odesli instanceof Error) throw odesli;
        return odesli || [];
      },
    },
    mbUrlRelsSource: {
      getDirectLinks: async () => mb || { seedUrl: null, links: [] },
    },
  });
  return { service, upsert };
}

describe('availability-resolution-service', () => {
  it('mergeLinks unions sources and keeps higher confidence; applies floor', () => {
    const rows = mergeLinks(
      [
        { platform: 'appleMusic', url: 'https://am/1' },
        { platform: 'spotify', url: 'https://sp/1' },
      ],
      [{ service: 'apple_music', url: 'https://mb-am/1' }],
      'existing',
      0.95
    );
    const apple = rows.find((r) => r.service === 'apple_music');
    assert.strictEqual(apple.url, 'https://am/1'); // 0.95 odesli beats 0.9 mb
    assert.ok(rows.find((r) => r.service === 'spotify'));

    const floored = mergeLinks(
      [{ platform: 'spotify', url: 'https://sp/1' }],
      [],
      'itunes',
      0.3 // below floor
    );
    assert.strictEqual(floored.length, 0);
  });

  it('skips when there is no seed and no MusicBrainz links', async () => {
    const { service, upsert } = build({ seed: null, odesli: [], mb: null });
    const result = await service.resolveAvailability(album);
    assert.deepStrictEqual(result, {
      action: 'skip',
      reason: 'no-seed',
      transient: false,
    });
    assert.strictEqual(upsert.mock.calls.length, 0);
  });

  it('resolves and persists one row per platform', async () => {
    const { service, upsert } = build({
      seed: { kind: 'existing', confidence: 0.95, seed: { url: 'x' } },
      odesli: [
        { platform: 'spotify', url: 'https://sp/1' },
        { platform: 'tidal', url: 'https://td/1' },
        { platform: 'unknownThing', url: 'https://x/1' }, // dropped (unmapped)
      ],
      mb: { seedUrl: null, links: [] },
    });

    const result = await service.resolveAvailability(album);
    assert.strictEqual(result.action, 'resolved');
    assert.deepStrictEqual(result.services.sort(), ['spotify', 'tidal']);
    assert.strictEqual(upsert.mock.calls.length, 2);
    const first = upsert.mock.calls[0].arguments[0];
    assert.strictEqual(first.albumId, 'alb-1');
    assert.ok(first.strategy.startsWith('availability:existing'));
    assert.ok(first.externalUrl);
  });

  it('falls through to MusicBrainz links when Odesli errors', async () => {
    const odesliErr = Object.assign(new Error('boom'), { status: 500 });
    const { service, upsert } = build({
      seed: { kind: 'musicbrainz', confidence: 0.9, seed: { url: 'x' } },
      odesli: odesliErr,
      mb: {
        seedUrl: 'x',
        links: [{ service: 'apple_music', url: 'https://am/1' }],
      },
    });
    const result = await service.resolveAvailability(album);
    assert.strictEqual(result.action, 'resolved');
    assert.deepStrictEqual(result.services, ['apple_music']);
    assert.strictEqual(upsert.mock.calls.length, 1);
  });

  it('returns a transient skip when Odesli errors and no MB links', async () => {
    const { service } = build({
      seed: { kind: 'itunes', confidence: 0.8, seed: { url: 'x' } },
      odesli: Object.assign(new Error('rate'), { status: 429 }),
      mb: null,
    });
    const result = await service.resolveAvailability(album);
    assert.deepStrictEqual(result, {
      action: 'skip',
      reason: 'odesli-error',
      transient: true,
    });
  });

  it('does not persist in dry-run mode', async () => {
    const { service, upsert } = build({
      seed: { kind: 'existing', confidence: 0.95, seed: { url: 'x' } },
      odesli: [{ platform: 'deezer', url: 'https://dz/1' }],
      mb: null,
    });
    const result = await service.resolveAvailability(album, { persist: false });
    assert.strictEqual(result.action, 'resolved');
    assert.deepStrictEqual(result.services, ['deezer']);
    assert.strictEqual(upsert.mock.calls.length, 0);
  });
});
