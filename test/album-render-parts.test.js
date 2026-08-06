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
    assert.match(
      html,
      /onerror="this.onerror=null; this.parentElement.innerHTML=&quot;/
    );
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
});
