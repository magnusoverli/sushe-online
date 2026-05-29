/**
 * Tests for services/native-name-service.js
 *
 * The resolver recovers native artist/album spelling from a MusicBrainz
 * release-group id and decides whether to rewrite, leave alone, flag for review,
 * or skip — gated by the entity-matching canonical key so it only ever re-spells
 * the SAME album.
 */

const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const {
  resolveNativeAlbumName,
  isMusicbrainzId,
  joinArtistCredit,
} = require('../services/native-name-service');
const { createMockLogger } = require('./helpers');

const MB_ID = '00000000-0000-4000-8000-000000000000';

function mbFetch(releaseGroup, { ok = true, status = 200 } = {}) {
  return mock.fn(async () => ({
    ok,
    status,
    json: async () => releaseGroup,
  }));
}

describe('native-name-service', () => {
  describe('isMusicbrainzId', () => {
    it('accepts a UUID and rejects Spotify/other ids', () => {
      assert.strictEqual(isMusicbrainzId(MB_ID), true);
      assert.strictEqual(isMusicbrainzId('4abc123spotifyid'), false);
      assert.strictEqual(isMusicbrainzId(''), false);
      assert.strictEqual(isMusicbrainzId(null), false);
    });
  });

  describe('joinArtistCredit', () => {
    it('joins multi-artist credits with join phrases', () => {
      assert.strictEqual(
        joinArtistCredit([
          { name: 'A', joinphrase: ' & ' },
          { name: 'B', joinphrase: '' },
        ]),
        'A & B'
      );
    });

    it('returns empty for missing credit', () => {
      assert.strictEqual(joinArtistCredit(undefined), '');
      assert.strictEqual(joinArtistCredit([]), '');
    });
  });

  describe('resolveNativeAlbumName', () => {
    it('rewrites a slug-mangled name to the native spelling (the reported case)', async () => {
      const fetch = mbFetch({
        title: 'Rituel Initiation',
        'artist-credit': [{ name: "De l'Abîme Naît l'Aube" }],
      });

      const result = await resolveNativeAlbumName(
        {
          albumId: MB_ID,
          artist: 'De Labime Nait Laube',
          album: 'Rituel Initiation',
        },
        { fetch, logger: createMockLogger() }
      );

      assert.strictEqual(result.action, 'rewrite');
      assert.strictEqual(result.artist, "De l'Abîme Naît l'Aube");
      assert.strictEqual(result.album, 'Rituel Initiation');
      assert.strictEqual(fetch.mock.calls.length, 1);
      assert.ok(fetch.mock.calls[0].arguments[0].includes(MB_ID));
      assert.ok(
        fetch.mock.calls[0].arguments[0].includes('inc=artist-credits')
      );
    });

    it('is a noop when the stored name already matches MusicBrainz exactly', async () => {
      const fetch = mbFetch({
        title: 'OK Computer',
        'artist-credit': [{ name: 'Radiohead' }],
      });

      const result = await resolveNativeAlbumName(
        { albumId: MB_ID, artist: 'Radiohead', album: 'OK Computer' },
        { fetch, logger: createMockLogger() }
      );

      assert.strictEqual(result.action, 'noop');
    });

    it('flags for review when the MusicBrainz id points at a different album', async () => {
      const fetch = mbFetch({
        title: 'A Completely Different Record',
        'artist-credit': [{ name: 'Some Other Artist' }],
      });

      const result = await resolveNativeAlbumName(
        {
          albumId: MB_ID,
          artist: 'De Labime Nait Laube',
          album: 'Rituel Initiation',
        },
        { fetch, logger: createMockLogger() }
      );

      assert.strictEqual(result.action, 'review');
      assert.deepStrictEqual(result.native, {
        artist: 'Some Other Artist',
        album: 'A Completely Different Record',
      });
    });

    it('skips non-MusicBrainz ids without fetching', async () => {
      const fetch = mock.fn();
      const result = await resolveNativeAlbumName(
        { albumId: 'spotify:album:123', artist: 'X', album: 'Y' },
        { fetch, logger: createMockLogger() }
      );

      assert.strictEqual(result.action, 'skip');
      assert.strictEqual(result.reason, 'non-mb-id');
      assert.strictEqual(fetch.mock.calls.length, 0);
    });

    it('skips on a MusicBrainz error response', async () => {
      const fetch = mbFetch({}, { ok: false, status: 503 });
      const result = await resolveNativeAlbumName(
        { albumId: MB_ID, artist: 'X', album: 'Y' },
        { fetch, logger: createMockLogger() }
      );

      assert.strictEqual(result.action, 'skip');
      assert.strictEqual(result.reason, 'mb-status-503');
    });

    it('rewrites the artist while leaving an already-correct album (mixed)', async () => {
      const fetch = mbFetch({
        title: 'Caminhos de Água',
        'artist-credit': [{ name: 'Kaatayra' }],
      });

      const result = await resolveNativeAlbumName(
        { albumId: MB_ID, artist: 'Kaatayra', album: 'Caminhos de Agua' },
        { fetch, logger: createMockLogger() }
      );

      assert.strictEqual(result.action, 'rewrite');
      assert.strictEqual(result.album, 'Caminhos de Água');
      assert.strictEqual(result.artist, 'Kaatayra');
    });

    it('now rewrites a ø-album that special-letter folding bridges (Panopticon)', async () => {
      // Previously this was flagged "review" because ø did not fold to o;
      // with special-letter transliteration the keys match -> safe rewrite.
      const fetch = mbFetch({
        title: 'Det hjemsøkte hjertet',
        'artist-credit': [{ name: 'Panopticon' }],
      });

      const result = await resolveNativeAlbumName(
        {
          albumId: MB_ID,
          artist: 'Panopticon',
          album: 'Det Hjemsokte Hjertet',
        },
        { fetch, logger: createMockLogger() }
      );

      assert.strictEqual(result.action, 'rewrite');
      assert.strictEqual(result.album, 'Det hjemsøkte hjertet');
    });
  });
});
