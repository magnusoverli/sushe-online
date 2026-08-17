const { describe, it, before } = require('node:test');
const assert = require('node:assert');

const taxonomy = {
  schema_version: 1,
  rym: {
    primary_genres: ['Art Rock', 'Progressive Rock'],
    secondary_genres: ['Experimental Rock'],
    descriptors: ['complex', 'male vocalist'],
    languages: ['English'],
    scenes: ['Canterbury Scene'],
    movements: ['New Wave'],
    source_url:
      'https://rateyourmusic.com/release/album/example-artist/example-album/',
    extractor_version: 'rym-extractor/1',
    captured_at: '2026-08-15T10:00:00.000Z',
    received_at: '2026-08-15T10:01:00.000Z',
    complete: true,
  },
  manual_overrides: {
    genre_1: {
      value: 'Avant-Garde',
      source: 'manual',
      updated_by: 'exported-user',
      updated_at: '2026-08-15T11:00:00.000Z',
    },
  },
};

describe('taxonomy import/export helpers', () => {
  let helpers;

  before(async () => {
    helpers = await import('../src/js/modules/import-export.js');
  });

  it('serializes additive CSV taxonomy fields without changing legacy fields', () => {
    const fields = helpers.getTaxonomyCSVFields({
      taxonomy,
      taxonomy_updated_at: '2026-08-15T12:00:00.000Z',
    });

    assert.deepStrictEqual(JSON.parse(fields.rym_primary_genres_json), [
      'Art Rock',
      'Progressive Rock',
    ]);
    assert.deepStrictEqual(JSON.parse(fields.rym_secondary_genres_json), [
      'Experimental Rock',
    ]);
    assert.deepStrictEqual(JSON.parse(fields.rym_descriptors_json), [
      'complex',
      'male vocalist',
    ]);
    assert.deepStrictEqual(JSON.parse(fields.rym_languages_json), ['English']);
    assert.deepStrictEqual(JSON.parse(fields.rym_scenes_json), [
      'Canterbury Scene',
    ]);
    assert.deepStrictEqual(JSON.parse(fields.rym_movements_json), ['New Wave']);
    assert.deepStrictEqual(JSON.parse(fields.rym_taxonomy_provenance_json), {
      source_url:
        'https://rateyourmusic.com/release/album/example-artist/example-album/',
      extractor_version: 'rym-extractor/1',
      captured_at: '2026-08-15T10:00:00.000Z',
      received_at: '2026-08-15T10:01:00.000Z',
      complete: true,
    });
    assert.deepStrictEqual(
      JSON.parse(fields.manual_genre_overrides_json),
      taxonomy.manual_overrides
    );
    assert.strictEqual(fields.taxonomy_updated_at, '2026-08-15T12:00:00.000Z');
  });

  it('converts JSON and flattened CSV taxonomy to source observations', () => {
    const album = {
      artist: 'Example Artist',
      album: 'Example Album',
      taxonomy,
      taxonomy_updated_at: '2026-08-15T12:00:00.000Z',
    };
    const observation = helpers.taxonomyToSourceObservation(album);
    const csvFields = helpers.getTaxonomyCSVFields(album);

    assert.deepStrictEqual(observation, {
      schemaVersion: 1,
      source: 'rateyourmusic',
      identity: {
        numericId: null,
        artist: 'Example Artist',
        title: 'Example Album',
        canonicalUrl:
          'https://rateyourmusic.com/release/album/example-artist/example-album/',
      },
      platformLinks: [],
      taxonomy: {
        complete: true,
        primaryGenres: ['Art Rock', 'Progressive Rock'],
        secondaryGenres: ['Experimental Rock'],
        descriptors: ['complex', 'male vocalist'],
        languages: ['English'],
        scenes: ['Canterbury Scene'],
        movements: ['New Wave'],
        sourceUrl:
          'https://rateyourmusic.com/release/album/example-artist/example-album/',
        extractorVersion: 'rym-extractor/1',
        capturedAt: '2026-08-15T10:00:00.000Z',
      },
    });
    assert.deepStrictEqual(
      helpers.taxonomyToSourceObservation({
        artist: album.artist,
        album: album.album,
        ...csvFields,
      }),
      observation
    );

    const prepared = helpers.prepareAlbumForImport(album);
    assert.deepStrictEqual(prepared.sourceObservation, observation);
    assert.strictEqual(Object.hasOwn(prepared, 'taxonomy_updated_at'), false);
  });

  it('resolves override values to local canonical IDs without replaying authority metadata', () => {
    const updates = helpers.buildManualGenreOverrideUpdates(
      [
        {
          artist: 'Example Artist',
          album: 'Example Album',
          album_id: 'exported-id',
          taxonomy,
        },
      ],
      [
        {
          artist: 'Example Artist',
          album: 'Example Album',
          album_id: 'local-id',
        },
      ]
    );

    assert.deepStrictEqual(updates, [
      { albumId: 'local-id', overrides: { genre_1: 'Avant-Garde' } },
    ]);
  });

  it('keeps existing duplicate data while planning taxonomy enrichment', () => {
    const existing = [
      {
        artist: 'Example Artist',
        album: 'Example Album',
        album_id: 'local-id',
        comments: 'Keep this',
      },
    ];
    const imported = [
      {
        artist: 'Example Artist',
        album: 'Example Album',
        album_id: 'exported-id',
        taxonomy,
      },
      { artist: 'New Artist', album: 'New Album', taxonomy },
    ];

    const plan = helpers.buildTaxonomyAwareMerge(existing, imported);

    assert.strictEqual(plan.mergedList.length, 2);
    assert.strictEqual(plan.mergedList[0], existing[0]);
    assert.strictEqual(plan.mergedList[0].comments, 'Keep this');
    assert.strictEqual(plan.newAlbums.length, 1);
    assert.strictEqual(plan.mergedList[1].sourceObservation.schemaVersion, 1);
    assert.strictEqual(plan.duplicateTaxonomyAlbums.length, 1);
    assert.strictEqual(
      plan.duplicateTaxonomyAlbums[0].sourceObservation.identity.canonicalUrl,
      taxonomy.rym.source_url
    );
  });
});

describe('list taxonomy import', () => {
  it('writes observations, then applies overrides to the resolved album ID', async () => {
    const { createListImporter } =
      await import('../src/js/modules/app-list-import.js');
    const calls = [];
    const apiCall = async (url, options = {}) => {
      calls.push({ url, options });
      if (url === '/api/lists') return { _id: 'new-list' };
      if (url === '/api/lists/new-list') {
        return [
          {
            _id: 'item-local',
            album_id: 'album-local',
            artist: 'Example Artist',
            album: 'Example Album',
          },
        ];
      }
      return { success: true };
    };
    const lists = {};
    const importList = createListImporter({
      apiCall,
      showToast() {},
      getLists: () => lists,
      logger: { warn() {}, log() {} },
    });

    await importList('Taxonomy List', [
      {
        artist: 'Example Artist',
        album: 'Example Album',
        album_id: 'album-exported',
        taxonomy,
        taxonomy_updated_at: '2026-08-15T12:00:00.000Z',
        primary_track: 'Track One',
        summary: 'Imported summary',
      },
    ]);

    const createBody = JSON.parse(calls[0].options.body);
    assert.strictEqual(createBody.data[0].sourceObservation.schemaVersion, 1);
    assert.strictEqual(
      Object.hasOwn(createBody.data[0], 'taxonomy_updated_at'),
      false
    );

    const genreCall = calls.find(({ url }) => url.endsWith('/genres'));
    assert.strictEqual(genreCall.url, '/api/albums/album-local/genres');
    assert.deepStrictEqual(JSON.parse(genreCall.options.body), {
      genre_1: 'Avant-Garde',
    });
    assert.ok(calls.some(({ url }) => url === '/api/track-picks/item-local'));
    assert.ok(
      calls.some(({ url }) => url === '/api/albums/album-local/summary')
    );
  });
});
