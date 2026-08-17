const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  parseAlbumLink,
} = require('../services/external-identity/album-link-policy');

function element({
  text = '',
  href = '',
  attributes = {},
  children = {},
} = {}) {
  return {
    textContent: text,
    href,
    getAttribute: (name) => attributes[name] ?? null,
    querySelectorAll: (selector) => children[selector] || [],
  };
}

function documentFrom(selectors) {
  return {
    querySelector: (selector) => selectors[selector]?.[0] || null,
    querySelectorAll: (selector) => selectors[selector] || [],
  };
}

function loadExtractor() {
  delete globalThis.AlbumIdentity;
  delete globalThis.RymAlbumExtractor;
  delete require.cache[
    require.resolve('../browser-extension/album-identity-service.js')
  ];
  delete require.cache[
    require.resolve('../browser-extension/rym-album-extractor.js')
  ];
  require('../browser-extension/album-identity-service.js');
  require('../browser-extension/rym-album-extractor.js');
}

describe('RateYourMusic album observation extractor', () => {
  beforeEach(loadExtractor);

  it('extracts canonical identity, ordered taxonomy, descriptors, and all platforms', () => {
    const primary = [
      element({ text: 'Art Rock' }),
      element({ text: 'Post-Rock' }),
    ];
    const secondary = [
      element({ text: 'Experimental Rock' }),
      element({ text: 'Ambient' }),
    ];
    const descriptorText = element({ text: 'atmospheric, melancholic' });
    const languageRow = element({
      children: {
        'th.info_hdr': [element({ text: 'Languages' })],
        'td a': [element({ text: 'English' })],
      },
    });
    const scenesRow = element({
      children: {
        'th.info_hdr': [element({ text: 'Scenes' })],
        '.release_pri_genres a': [element({ text: 'Canterbury Scene' })],
      },
    });
    const movementsRow = element({
      children: {
        'th.info_hdr': [element({ text: 'Movements' })],
        '.release_pri_genres a': [element({ text: 'Rock Against Communism' })],
      },
    });
    const platformUrls = [
      'https://open.spotify.com/album/0123456789012345678901',
      'https://music.apple.com/us/album/example/1',
      'https://www.qobuz.com/us-en/album/example/id',
      'https://listen.tidal.com/album/1',
      'https://artist.bandcamp.com/album/example',
      'https://soundcloud.com/artist/example',
      'https://youtu.be/abcdefghijk',
    ];
    const mediaScope = element({
      children: {
        'a[href]': platformUrls.map((href) => element({ href })),
      },
    });
    const section = element();
    const doc = documentFrom({
      '[data-album-id]': [
        element({ attributes: { 'data-album-id': 'Album123' } }),
      ],
      '.release_pri_genres': [section],
      '.release_pri_genres .genre': primary,
      '.release_sec_genres': [section],
      '.release_sec_genres .genre': secondary,
      '.release_descriptors': [section],
      '.release_descriptors .release_pri_descriptors': [descriptorText],
      'table.album_info tr': [languageRow, scenesRow, movementsRow],
      '.release_media_links': [mediaScope],
    });

    const observation = globalThis.RymAlbumExtractor.extract(
      doc,
      'http://www.rateyourmusic.com/release/album/talk-talk/spirit-of-eden/?x=1#reviews'
    );

    assert.strictEqual(observation.schemaVersion, 1);
    assert.strictEqual(
      observation.taxonomy.sourceUrl,
      observation.identity.canonicalUrl
    );
    assert.strictEqual(observation.taxonomy.complete, true);
    assert.deepStrictEqual(observation.identity, {
      numericId: '123',
      canonicalPath: '/release/album/talk-talk/spirit-of-eden/',
      canonicalUrl:
        'https://rateyourmusic.com/release/album/talk-talk/spirit-of-eden/',
      artist: 'Talk Talk',
      title: 'Spirit Of Eden',
    });
    assert.deepStrictEqual(observation.taxonomy.primaryGenres, [
      'Art Rock',
      'Post-Rock',
    ]);
    assert.deepStrictEqual(observation.taxonomy.secondaryGenres, [
      'Experimental Rock',
      'Ambient',
    ]);
    assert.deepStrictEqual(observation.taxonomy.descriptors, [
      'atmospheric',
      'melancholic',
    ]);
    assert.deepStrictEqual(observation.taxonomy.languages, ['English']);
    assert.deepStrictEqual(observation.taxonomy.scenes, ['Canterbury Scene']);
    assert.deepStrictEqual(observation.taxonomy.movements, [
      'Rock Against Communism',
    ]);
    assert.deepStrictEqual(
      observation.platformLinks.map(({ service }) => service),
      [
        'spotify',
        'itunes',
        'qobuz',
        'tidal',
        'bandcamp',
        'soundcloud',
        'youtube',
      ]
    );
    assert.ok(
      observation.platformLinks.every(({ service, url }) =>
        parseAlbumLink(url, service)
      )
    );
    assert.strictEqual(
      observation.taxonomy.extractorVersion,
      'rym-extension/1.9.6'
    );
    assert.ok(!Number.isNaN(Date.parse(observation.taxonomy.capturedAt)));
    assert.deepStrictEqual(Object.keys(observation).sort(), [
      'identity',
      'platformLinks',
      'schemaVersion',
      'taxonomy',
    ]);
  });

  it('accepts only exact fixture-backed Album ID text', () => {
    const valid = documentFrom({
      '.album_id': [element({ text: '[Album98765]' })],
    });
    const invalid = documentFrom({
      '.album_id': [element({ text: 'Release [Album98765]' })],
    });
    const url =
      'https://rateyourmusic.com/release/album/artist-name/album-name/';

    assert.strictEqual(
      globalThis.RymAlbumExtractor.extract(valid, url).identity.numericId,
      '98765'
    );
    assert.strictEqual(
      globalThis.RymAlbumExtractor.extract(invalid, url).identity.numericId,
      null
    );
  });

  it('falls back to descriptor-row meta content', () => {
    const descriptorRow = element({
      children: {
        'meta[content]': [
          element({ attributes: { content: ' atmospheric' } }),
          element({ attributes: { content: 'melancholic' } }),
        ],
      },
    });
    const doc = documentFrom({
      '.release_descriptors': [descriptorRow],
      'tr.release_descriptors': [descriptorRow],
    });

    const observation = globalThis.RymAlbumExtractor.extract(
      doc,
      'https://rateyourmusic.com/release/album/artist/album/'
    );

    assert.deepStrictEqual(observation.taxonomy.descriptors, [
      'atmospheric',
      'melancholic',
    ]);
  });

  it('rejects platform host spoofing instead of matching URL substrings', () => {
    const mediaScope = element({
      children: {
        'a[href]': [
          element({
            href: 'https://open.spotify.com.evil.example/album/spoof',
          }),
          element({
            href: 'https://evil.example/?next=open.spotify.com/album/spoof',
          }),
          element({
            href: 'https://open.spotify.com/album/0123456789012345678901',
          }),
        ],
      },
    });
    const observation = globalThis.RymAlbumExtractor.extract(
      documentFrom({ '.release_media_links': [mediaScope] }),
      'https://rateyourmusic.com/release/album/artist/album/'
    );

    assert.deepStrictEqual(observation.platformLinks, [
      {
        service: 'spotify',
        url: 'https://open.spotify.com/album/0123456789012345678901',
      },
    ]);
  });

  it('rejects non-RYM hosts and non-album release paths', () => {
    const identity = globalThis.AlbumIdentity;
    assert.strictEqual(
      identity.getAlbumIdentityFromUrl(
        'https://rateyourmusic.com.evil.example/release/album/a/b/'
      ),
      null
    );
    assert.strictEqual(
      identity.getAlbumIdentityFromUrl(
        'https://rateyourmusic.com/release/single/a/b/'
      ),
      null
    );
    assert.strictEqual(
      identity.getAlbumIdentityFromUrl(
        'https://rateyourmusic.com/release/album/a/b/extra/'
      ),
      null
    );
    assert.strictEqual(
      identity.getAlbumIdentityFromUrl(
        'https://rateyourmusic.com/release/album/a%2Fb/album/'
      ),
      null
    );
    assert.strictEqual(
      identity.getAlbumIdentityFromUrl(
        'https://rateyourmusic.com/release//album/a/b/'
      ),
      null
    );
  });
});
