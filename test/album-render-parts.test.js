const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('album render parts', () => {
  it('renders shared desktop album cells for recommendation data', async () => {
    const {
      renderDesktopAlbumCell,
      renderDesktopArtistCell,
      renderDesktopCoverCell,
      renderDesktopGenreCell,
    } = await import('../src/js/modules/album-display/render-parts.js');

    const album = {
      albumName: 'Shared Album',
      artist: 'Shared Artist',
      releaseDate: '07/05/2026',
      genre1: 'Jazz',
      genre1Display: 'Jazz',
      genre1Class: 'text-gray-400',
      genre2: '',
      genre2Display: 'No genre',
      genre2Class: 'text-gray-600 italic',
      coverThumbUrl: '/api/albums/abc/cover',
      coverImageUrl: '/api/albums/abc/cover',
      availability: [],
    };

    const html = [
      renderDesktopCoverCell(album, 0, {
        badgesHtml: '<div class="in-user-lists-badge"></div>',
        loadMode: 'lazy',
      }),
      renderDesktopAlbumCell(album, {
        includeAvailability: false,
        includePlaycount: false,
        includeTitle: true,
      }),
      renderDesktopArtistCell(album, {
        includeTitle: true,
        interactive: false,
      }),
      renderDesktopGenreCell(album, 1, { includeTitle: true }),
      renderDesktopGenreCell(album, 2, {
        emptyTextClass: 'text-gray-600 italic',
        emptyText: 'No genre',
        includeTitle: true,
      }),
    ].join('');

    assert.match(html, /loading="lazy"/);
    assert.doesNotMatch(html, /onerror=/);
    assert.match(html, /data-cover-src="\/api\/albums\/abc\/cover"/);
    assert.match(html, /data-cover-media/);
    assert.match(html, /class="w-full h-full" data-cover-media/);
    assert.match(html, /data-desktop-album-badges/);
    assert.match(html, /in-user-lists-badge/);
    assert.match(html, /Shared Album/);
    assert.match(html, /title="Shared Artist"/);
    assert.match(html, /Jazz/);
    assert.match(html, /No genre/);
  });

  it('renders shared mobile card sections with optional recommendation wrappers', async () => {
    const {
      renderMobileArtistRow,
      renderMobileCoverSection,
      renderMobileGenreRow,
      renderMobileTitleRow,
    } = await import('../src/js/modules/album-display/render-parts.js');

    const album = {
      albumName: 'Mobile Album',
      artist: 'Mobile Artist',
      releaseDate: 'Jul 5, 2026',
      genre1: '',
      genre2: '',
      coverThumbUrl: '/api/albums/mobile/cover',
      coverImageUrl: '/api/albums/mobile/cover',
      availability: [],
    };

    const html = [
      renderMobileCoverSection(album, 0, {
        coverExtraHtml: '<div class="in-user-lists-badge-mobile"></div>',
        dateText: 'Jul 5, 2026',
        dateWrapperClass: 'flex-1 flex items-center mt-1',
        includeAvailability: false,
        loadMode: 'lazy',
      }),
      renderMobileTitleRow(album, {
        titleSpanClass: 'truncate flex-1 min-w-0',
        titleStyle: '',
      }),
      renderMobileArtistRow(album, {
        spanClass: 'truncate flex-1 min-w-0',
      }),
      renderMobileGenreRow(album, {
        emptyHtml: '<span class="text-gray-600 italic">No genre</span>',
        emptyText: 'No genre',
      }),
    ].join('');

    assert.match(html, /in-user-lists-badge-mobile/);
    assert.match(html, /loading="lazy"/);
    assert.match(html, /Jul 5, 2026/);
    assert.match(html, /data-field="album-mobile-title"/);
    assert.match(html, /data-mobile-album-badges/);
    assert.doesNotMatch(html, /font-size: 13px; font-weight: 700/);
    assert.match(html, /Mobile Artist/);
    assert.match(html, /No genre/);
  });

  it('uses the shame GIF only as the display cover for disqualified albums', async () => {
    const {
      getDisplayCoverSources,
      renderDesktopCoverCell,
      renderMobileCoverSection,
    } = await import('../src/js/modules/album-display/render-parts.js');
    const album = {
      albumName: 'Disqualified Album',
      coverThumbUrl: '/api/albums/album-1/cover?size=thumb',
      coverImageUrl: '/api/albums/album-1/cover',
      isDisqualified: true,
      availability: [],
    };

    const desktop = renderDesktopCoverCell(album, 30);
    const mobile = renderMobileCoverSection(album, 30);

    assert.match(desktop, /src="\/shame-go-t\.gif"/);
    assert.match(desktop, /data-full-src="\/shame-go-t\.gif"/);
    assert.doesNotMatch(desktop, /api\/albums\/album-1\/cover/);
    assert.match(mobile, /src="\/shame-go-t\.gif"/);
    assert.strictEqual(getDisplayCoverSources(album).src, '/shame-go-t.gif');
    assert.deepStrictEqual(
      getDisplayCoverSources({ ...album, isDisqualified: false }),
      {
        src: '/api/albums/album-1/cover?size=thumb',
        fullSrc: '/api/albums/album-1/cover',
      }
    );
  });

  it('integrates taxonomy triggers and provider links without inline details', async () => {
    const {
      renderDesktopAlbumCell,
      renderMobileGenreRow,
      renderMobileTaxonomyBadge,
    } = await import('../src/js/modules/album-display/render-parts.js');
    const album = {
      albumName: 'Taxonomy Album',
      availability: ['soundcloud'],
      availabilityLinks: [
        {
          service: 'soundcloud',
          url: 'https://soundcloud.com/artist/sets/record',
        },
      ],
      taxonomy: {
        rym: {
          primary_genres: ['Rock'],
          secondary_genres: ['Ambient'],
          descriptors: ['Warm'],
          source_url: 'https://rateyourmusic.com/release/album/artist/record/',
        },
      },
      genre1: 'Legacy genre 1',
      genre2: 'Legacy genre 2',
    };

    const desktop = renderDesktopAlbumCell(album, {
      includeAvailabilityLinks: true,
      includePlaycount: false,
      includeTaxonomy: true,
    });
    const mobileGenre = renderMobileGenreRow(album);
    const mobileBadge = renderMobileTaxonomyBadge(album);

    assert.match(desktop, /<a [^>]*aria-label="SoundCloud"/);
    assert.match(desktop, /data-taxonomy-slot/);
    assert.match(desktop, /class="taxonomy-trigger"/);
    assert.doesNotMatch(desktop, /<dt>|album-taxonomy-panel/);
    assert.match(mobileGenre, /Legacy genre 1 \/ Legacy genre 2/);
    assert.doesNotMatch(mobileGenre, /taxonomy-trigger-mobile/);
    assert.match(mobileBadge, /taxonomy-trigger-mobile/);
    assert.doesNotMatch(mobileBadge, /<dt>|album-taxonomy-panel/);
  });

  it('renders compact disqualification labels away from title badges', async () => {
    const {
      renderDesktopAlbumCell,
      renderMobileDisqualificationSlot,
      renderMobileTitleRow,
    } = await import('../src/js/modules/album-display/render-parts.js');
    const album = {
      albumName: 'Excluded Album',
      availability: [],
      isDisqualified: true,
      disqualificationReason: '<review & reject>',
    };

    const desktop = renderDesktopAlbumCell(album, {
      includePlaycount: false,
      includeAvailability: false,
    });
    const mobileTitle = renderMobileTitleRow(album);
    const mobile = renderMobileDisqualificationSlot(album);

    assert.match(desktop, /Disqualified/);
    assert.match(desktop, /&lt;review &amp; reject&gt;/);
    assert.match(desktop, /aria-label="Disqualified from ranking:/);
    assert.match(desktop, /album-meta-row[\s\S]*data-disqualification-slot/);
    assert.doesNotMatch(
      desktop,
      /<span>Disqualified<\/span><span[^>]*>.*review/
    );
    assert.doesNotMatch(desktop, /<review & reject>/);
    assert.doesNotMatch(mobileTitle, /data-disqualification-slot/);
    assert.match(mobile, /Disqualified/);
    assert.match(mobile, /mobile-disqualification-slot/);
    assert.match(mobile, /title="Disqualified from ranking:/);
  });
});
