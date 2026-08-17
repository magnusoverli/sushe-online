const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  LINK_RANKS,
  MAX_LINK_LENGTH,
  hostMatches,
  parseAlbumLink,
} = require('../services/external-identity/album-link-policy');

describe('album-link-policy', () => {
  it('normalizes supported album and RYM release links', () => {
    const cases = [
      {
        url: 'https://rateyourmusic.com/release/album/artist/record/?utm_source=x',
        service: 'rateyourmusic',
        id: null,
        canonical: 'https://rateyourmusic.com/release/album/artist/record/',
      },
      {
        url: 'https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy?si=secret',
        service: 'spotify',
        id: '4aawyAB9vmqN3uQ7FjRGTy',
        canonical: 'https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy',
      },
      {
        url: 'https://music.apple.com/us/album/record/1655432387?uo=4',
        service: 'itunes',
        id: '1655432387',
        canonical: 'https://music.apple.com/us/album/record/1655432387',
      },
      {
        url: 'https://itunes.apple.com/fr/album/record/id1679530462?mt=1',
        service: 'itunes',
        id: '1679530462',
        canonical: 'https://itunes.apple.com/fr/album/record/id1679530462',
      },
      {
        url: 'https://www.qobuz.com/album/0060253783288?utm_medium=x',
        service: 'qobuz',
        id: '0060253783288',
        canonical: 'https://play.qobuz.com/album/0060253783288',
      },
      {
        url: 'https://listen.tidal.com/album/288984589?foo=bar',
        service: 'tidal',
        id: '288984589',
        canonical: 'https://tidal.com/browse/album/288984589',
      },
      {
        url: 'https://artist.bandcamp.com/album/record?from=fanpub_fnb',
        service: 'bandcamp',
        id: 'artist/record',
        canonical: 'https://artist.bandcamp.com/album/record',
      },
    ];

    for (const entry of cases) {
      const parsed = parseAlbumLink(entry.url);
      assert.ok(parsed, entry.url);
      assert.strictEqual(parsed.service, entry.service);
      assert.strictEqual(parsed.externalAlbumId, entry.id);
      assert.strictEqual(parsed.externalUrl, entry.canonical);
    }
  });

  it('prefers SoundCloud sets and YouTube playlists over item links', () => {
    const set = parseAlbumLink(
      'https://soundcloud.com/artist/sets/the-record?utm_source=x'
    );
    const track = parseAlbumLink(
      'https://soundcloud.com/artist/the-track?si=secret'
    );
    const playlist = parseAlbumLink(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890&utm_source=x'
    );
    const video = parseAlbumLink('https://youtu.be/dQw4w9WgXcQ?si=secret');

    assert.strictEqual(set.linkType, 'set');
    assert.strictEqual(track.linkType, 'track');
    assert.ok(set.rank > track.rank);
    assert.strictEqual(playlist.linkType, 'playlist');
    assert.strictEqual(
      playlist.externalUrl,
      'https://www.youtube.com/playlist?list=PL1234567890'
    );
    assert.strictEqual(video.linkType, 'video');
    assert.strictEqual(
      video.externalUrl,
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    );
    assert.ok(playlist.rank > video.rank);
    assert.strictEqual(set.rank, LINK_RANKS.COLLECTION);
  });

  it('enforces expected service without accepting a different provider', () => {
    const url = 'https://tidal.com/album/123';
    assert.strictEqual(parseAlbumLink(url, 'spotify'), null);
    assert.strictEqual(parseAlbumLink(url, 'tidal').service, 'tidal');
  });

  it('uses exact or dot-boundary hostname matching', () => {
    assert.strictEqual(hostMatches('spotify.com', 'spotify.com'), true);
    assert.strictEqual(hostMatches('open.spotify.com', 'spotify.com'), true);
    assert.strictEqual(hostMatches('notspotify.com', 'spotify.com'), false);
    assert.strictEqual(
      hostMatches('spotify.com.evil.test', 'spotify.com'),
      false
    );
  });

  it('rejects unsafe URL forms and provider lookalikes', () => {
    const invalid = [
      'http://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy',
      'https://user:pass@open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy',
      'https://open.spotify.com:444/album/4aawyAB9vmqN3uQ7FjRGTy',
      'https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy#fragment',
      'https://open.spotify.com/album%2f4aawyAB9vmqN3uQ7FjRGTy',
      'https://open.spotify.com/album/%0a4aawyAB9vmqN3uQ7FjRGTy',
      'https://open.spotify.com/ignore/%2e%2e/album/4aawyAB9vmqN3uQ7FjRGTy',
      'https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy?utm_source=%0a',
      'https://open.spotify.com\\@evil.test/album/4aawyAB9vmqN3uQ7FjRGTy',
      'https://open.spotify.com.evil.test/album/4aawyAB9vmqN3uQ7FjRGTy',
      'https://notspotify.com/album/4aawyAB9vmqN3uQ7FjRGTy',
      'https://soundcloud.com/search/albums',
      'https://soundcloud.com/artist/sets',
      'https://www.youtube.com/watch?v=too-short',
      `https://rateyourmusic.com/${'a'.repeat(MAX_LINK_LENGTH)}`,
      'not a url',
    ];

    for (const url of invalid) {
      assert.strictEqual(parseAlbumLink(url), null, url);
    }
  });
});
