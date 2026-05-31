const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const {
  createAvailabilityResolutionService,
  mergeCandidates,
  buildCandidates,
} = require('../services/availability-resolution-service');
const { createMockLogger } = require('./helpers');

const album = { albumId: 'alb-1', artist: 'Metallica', album: '72 Seasons' };

function build({ seed, odesli, mb, directSources }) {
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
      getDirectLinks: async () => mb || { seedUrl: null, upc: null, links: [] },
    },
    directSources,
  });
  return { service, upsert };
}

describe('availability-resolution-service', () => {
  it('merge unions sources and keeps higher confidence; applies floor', () => {
    const rows = mergeCandidates(
      buildCandidates({
        odesliLinks: [
          { platform: 'itunes', url: 'https://it/1' },
          { platform: 'spotify', url: 'https://sp/1' },
        ],
        seedKind: 'existing',
        seedConfidence: 0.95,
        mbLinks: [{ service: 'itunes', url: 'https://mb-it/1' }],
        directContributions: [],
      })
    );
    const itunes = rows.find((r) => r.service === 'itunes');
    assert.strictEqual(itunes.url, 'https://it/1'); // 0.95 odesli beats 0.9 mb
    assert.ok(rows.find((r) => r.service === 'spotify'));

    const floored = mergeCandidates(
      buildCandidates({
        odesliLinks: [{ platform: 'spotify', url: 'https://sp/1' }],
        seedKind: 'itunes',
        seedConfidence: 0.3, // below floor
        mbLinks: [],
        directContributions: [],
      })
    );
    assert.strictEqual(floored.length, 0);
  });

  it('folds UPC-exact direct sources into the merged rows', () => {
    const rows = mergeCandidates(
      buildCandidates({
        odesliLinks: [{ platform: 'spotify', url: 'https://sp/1' }],
        seedKind: 'itunes',
        seedConfidence: 0.6,
        mbLinks: [],
        directContributions: [
          {
            name: 'qobuz',
            links: [
              { service: 'qobuz', url: 'https://qb/1', confidence: 0.97 },
            ],
          },
          {
            name: 'itunes',
            links: [
              {
                service: 'itunes',
                url: 'https://music.apple.com/us/album/1',
                confidence: 0.97,
              },
            ],
          },
        ],
      })
    );
    const qobuz = rows.find((r) => r.service === 'qobuz');
    assert.strictEqual(qobuz.url, 'https://qb/1');
    assert.strictEqual(qobuz.strategy, 'availability:qobuz');
    const itunes = rows.find((r) => r.service === 'itunes');
    assert.strictEqual(itunes.strategy, 'availability:itunes');
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
    assert.strictEqual(first.externalUrl, undefined);
  });

  it('falls through to MusicBrainz links when Odesli errors', async () => {
    const odesliErr = Object.assign(new Error('boom'), { status: 500 });
    const { service, upsert } = build({
      seed: { kind: 'musicbrainz', confidence: 0.9, seed: { url: 'x' } },
      odesli: odesliErr,
      mb: {
        seedUrl: 'x',
        links: [{ service: 'itunes', url: 'https://it/1' }],
      },
    });
    const result = await service.resolveAvailability(album);
    assert.strictEqual(result.action, 'resolved');
    assert.deepStrictEqual(result.services, ['itunes']);
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

  it('resolves via a target direct source when there is no seed', async () => {
    const { service, upsert } = build({
      seed: null,
      odesli: [],
      mb: { seedUrl: null, upc: '886443927087', links: [] },
      directSources: [
        {
          name: 'qobuz',
          getLinks: async ({ upc }) => ({
            links: upc
              ? [{ service: 'qobuz', url: 'https://qb/1', confidence: 0.97 }]
              : [],
          }),
        },
      ],
    });

    const result = await service.resolveAvailability(album);
    assert.strictEqual(result.action, 'resolved');
    assert.deepStrictEqual(result.services, ['qobuz']);
    assert.strictEqual(upsert.mock.calls.length, 1);
    assert.strictEqual(
      upsert.mock.calls[0].arguments[0].strategy,
      'availability:qobuz'
    );
  });

  it('resolves via a non-UPC direct source when there is no seed', async () => {
    const { service, upsert } = build({
      seed: null,
      odesli: [],
      mb: { seedUrl: null, upc: null, links: [] },
      directSources: [
        {
          name: 'spotify',
          getLinks: async ({ artist }) => ({
            links: artist
              ? [
                  {
                    service: 'spotify',
                    url: 'https://open.spotify.com/album/sp1',
                    confidence: 0.97,
                    externalAlbumId: 'sp1',
                    externalArtist: 'Metallica',
                    externalAlbum: '72 Seasons',
                  },
                ]
              : [],
          }),
        },
      ],
    });

    const result = await service.resolveAvailability(album);

    assert.strictEqual(result.action, 'resolved');
    assert.deepStrictEqual(result.services, ['spotify']);
    assert.strictEqual(upsert.mock.calls.length, 1);
    assert.deepStrictEqual(upsert.mock.calls[0].arguments[0], {
      albumId: 'alb-1',
      service: 'spotify',
      externalAlbumId: 'sp1',
      externalArtist: 'Metallica',
      externalAlbum: '72 Seasons',
      confidence: 0.97,
      strategy: 'availability:spotify',
    });
  });

  it('does not persist in dry-run mode', async () => {
    const { service, upsert } = build({
      seed: { kind: 'existing', confidence: 0.95, seed: { url: 'x' } },
      odesli: [{ platform: 'bandcamp', url: 'https://bc/1' }],
      mb: null,
    });
    const result = await service.resolveAvailability(album, { persist: false });
    assert.strictEqual(result.action, 'resolved');
    assert.deepStrictEqual(result.services, ['bandcamp']);
    assert.strictEqual(upsert.mock.calls.length, 0);
  });
});
