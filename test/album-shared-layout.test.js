const { before, describe, it } = require('node:test');
const assert = require('node:assert/strict');

let renderDesktopAlbumRow;
let renderDesktopAlbumHeader;
let renderMobileAlbumCard;
let renderDesktopGenreCell;
let getAllColumns;
let computeGridTemplate;

before(async () => {
  ({ renderDesktopAlbumRow, renderDesktopAlbumHeader } =
    await import('../src/js/modules/album-display/desktop-layout.js'));
  ({ renderMobileAlbumCard } =
    await import('../src/js/modules/album-display/mobile-layout.js'));
  ({ renderDesktopGenreCell } =
    await import('../src/js/modules/album-display/render-parts.js'));
  ({ getAllColumns, computeGridTemplate } =
    await import('../src/js/modules/column-config.js'));
});

function album(overrides = {}) {
  return {
    position: 1,
    albumName: 'Shared Album',
    artist: 'Shared Artist',
    releaseDate: '07/05/2026',
    country: 'Norway',
    countryDisplay: 'Norway',
    countryClass: 'text-gray-300',
    genre1: 'Jazz',
    genre1Display: 'Jazz',
    genre1Class: 'text-gray-300',
    genre2: '',
    genre2Display: 'Genre 2',
    genre2Class: 'text-gray-800 italic',
    primaryTrack: 'First Song',
    primaryTrackDisplay: '#1 - First Song',
    primaryTrackClass: 'text-gray-300',
    primaryTrackDuration: '03:12',
    secondaryTrack: 'Second Song',
    secondaryTrackDisplay: '#2 - Second Song',
    secondaryTrackClass: 'text-gray-300',
    secondaryTrackDuration: '04:20',
    hasSecondaryTrack: true,
    comment: 'A comment',
    comment2: 'Another comment',
    itemId: 'item-1',
    playcount: 1234,
    playcountDisplay: { isEmpty: false, isNotFound: false, html: '1.2K' },
    coverThumbUrl: '/api/albums/album-1/cover?size=thumb',
    coverImageUrl: '/api/albums/album-1/cover',
    availability: ['spotify'],
    availabilityLinks: [
      { service: 'spotify', url: 'https://open.spotify.com/album/album-1' },
    ],
    ...overrides,
  };
}

describe('shared desktop album layout', () => {
  it('uses explicit registry columns and identical grids in read-only and owner layouts', () => {
    const columns = getAllColumns();
    const visibleColumns = columns.filter(
      ({ id }) => !['country', 'comment_2'].includes(id)
    );
    const options = { columns, visibleColumns };
    const header = renderDesktopAlbumHeader(options);
    const readonly = renderDesktopAlbumRow(album(), 4, options);
    const owner = renderDesktopAlbumRow(album(), 4, {
      ...options,
      editable: true,
    });

    assert.equal(header.gridTemplate, computeGridTemplate(visibleColumns));
    assert.equal(readonly.gridTemplate, header.gridTemplate);
    assert.equal(owner.gridTemplate, header.gridTemplate);
    assert.equal(readonly.className, 'album-row album-grid gap-4 py-2');
    assert.equal(owner.className, readonly.className);
    assert.match(header.html, /country-cell column-hidden/);
    assert.match(
      readonly.html,
      /class="column-hidden flex items-center country-cell"/
    );
    assert.match(
      owner.html,
      /class="column-hidden flex items-center country-cell"/
    );
    assert.match(header.html, /comment-2-cell pl-2 column-hidden/);
    assert.match(readonly.outerHTML, /data-index="4"/);
    assert.match(header.className, /sticky top-0/);
    assert.doesNotMatch(header.outerHTML, /position: relative/);
    for (const { cellClass } of columns) {
      assert.ok(readonly.html.includes(cellClass), cellClass);
      assert.ok(header.html.includes(cellClass), cellClass);
    }
    assert.doesNotMatch(
      readonly.html,
      /cursor-pointer|hover:text-gray-100|data-playcount=/
    );
    assert.match(owner.html, /track-cell min-w-0 cursor-pointer/);
    assert.match(owner.html, /line-clamp-2 cursor-pointer comment-text/);
  });

  it('renders only requested metadata columns, in their declared order', () => {
    const ids = ['album', 'cover', 'comment_2', 'track'];
    const columns = ids.map((id) =>
      getAllColumns().find((col) => col.id === id)
    );
    const row = renderDesktopAlbumRow(album(), 0, { columns });
    const header = renderDesktopAlbumHeader({ columns });
    assert.equal(row.gridTemplate, computeGridTemplate(columns));
    assert.equal(row.gridTemplate, header.gridTemplate);
    assert.doesNotMatch(
      row.html,
      /country-cell|artist-cell|genre-1-cell|comment-cell/
    );
    assert.ok(row.html.indexOf('album-cell') < row.html.indexOf('cover-cell'));
    assert.ok(
      row.html.indexOf('comment-2-cell') < row.html.indexOf('track-cell')
    );
    assert.match(row.html, /Another comment/);
    assert.match(row.html, /data-field="primary-track-text"/);
    assert.match(row.html, /data-field="secondary-track-duration"/);
    assert.throws(
      () => renderDesktopAlbumRow(album(), 0, { columns: [{ id: 'unknown' }] }),
      /Unsupported album column/
    );
  });

  it('reserves empty edit prompts for owners, including an explicitly empty genre', () => {
    const data = album({
      position: null,
      country: '',
      countryDisplay: 'Country',
      genre1: '',
      primaryTrackDisplay: '',
      hasSecondaryTrack: false,
      comment: '',
      comment2: '',
    });
    const options = { columns: getAllColumns() };
    const readonly = renderDesktopAlbumRow(data, 0, options);
    const owner = renderDesktopAlbumRow(data, 0, {
      ...options,
      editable: true,
    });
    assert.doesNotMatch(
      readonly.html,
      /Select Track|>Country<|>Genre [12]<|>Comment(?: 2)?</
    );
    assert.match(owner.html, /Select Track/);
    assert.match(owner.html, />Country</);
    assert.match(owner.html, />Genre 2</);
    assert.match(owner.html, />Comment 2</);
    assert.match(owner.html, /<div class="position-cell"><\/div>/);
    assert.doesNotMatch(
      renderDesktopGenreCell(data, 2, { emptyText: '', interactive: false }),
      />Genre 2</
    );
  });
});

describe('shared mobile album layout', () => {
  it('shares owner geometry and update hooks without default menus or playback affordances', () => {
    const readonly = renderMobileAlbumCard(album(), 2);
    const owner = renderMobileAlbumCard(album(), 2, {
      editable: true,
      includeTracks: true,
      includePlaycount: true,
      badgeHTML: '<span data-test-badge>Badge &amp; text</span>',
      badgeState: 'badge-state',
      badgePaddingRight: '31px',
    });
    assert.equal(readonly.wrapperClassName, 'album-card-wrapper h-[145px]');
    assert.equal(owner.wrapperClassName, readonly.wrapperClassName);
    assert.equal(
      readonly.className,
      'album-card album-row relative h-[145px] bg-gray-900'
    );
    assert.equal(owner.className, readonly.className);
    assert.match(readonly.outerHTML, /data-index="2"/);
    assert.match(readonly.html, /h-full shrink-0 w-\[88px\].*justify-evenly/);
    assert.match(readonly.html, /justify-evenly h-\[130px\] leading-\[18px\]/);
    assert.doesNotMatch(
      readonly.html,
      /data-album-menu-btn|data-track-play-btn|data-playcount-mobile|track-mobile-text|cursor-pointer/
    );
    assert.match(owner.html, /data-album-menu-btn/);
    assert.match(
      owner.html,
      /data-track-play-btn="true" data-track-identifier="First Song"/
    );
    assert.match(owner.html, /data-playcount-mobile="item-1"/);
    assert.match(owner.html, /data-field="primary-track-mobile-duration"/);
    assert.match(owner.html, /data-field="secondary-track-mobile-duration"/);
    assert.match(owner.html, /<span data-test-badge>Badge &amp; text<\/span>/);
    assert.equal(
      (owner.html.match(/data-mobile-badge-padding/g) || []).length,
      4
    );
    assert.equal((owner.html.match(/padding-right: 31px/g) || []).length, 5);
    for (const field of [
      'album-mobile-title',
      'artist-mobile-text',
      'country-mobile-text',
      'genre-mobile-text',
    ]) {
      assert.ok(readonly.html.includes(`data-field="${field}"`), field);
      assert.ok(owner.html.includes(`data-field="${field}"`), field);
    }
  });

  it('can display tracks without enabling interaction and keeps both empty owner track rows', () => {
    const readonly = renderMobileAlbumCard(album(), 0, { includeTracks: true });
    assert.match(readonly.html, /#1 - First Song/);
    assert.match(readonly.html, /#2 - Second Song/);
    assert.doesNotMatch(
      readonly.html,
      /data-track-play-btn|data-track-identifier|cursor-pointer/
    );
    const owner = renderMobileAlbumCard(
      album({ primaryTrackDisplay: '', secondaryTrackDisplay: '' }),
      0,
      {
        editable: true,
        includeTracks: true,
        menuHTML: '',
      }
    );
    assert.equal((owner.html.match(/data-track-play-btn=""/g) || []).length, 2);
    assert.match(owner.html, /data-field="secondary-track-mobile-text"/);
    assert.doesNotMatch(owner.html, /data-album-menu-btn/);
  });
});

describe('shared layout slots and safety', () => {
  it('preserves zero indices/counts and full metadata titles for read-only rows', () => {
    const data = album({
      playcount: 0,
      playcountDisplay: {
        html: '0',
        isEmpty: false,
        isNotFound: false,
      },
    });
    const row = renderDesktopAlbumRow(data, 0, {
      columns: getAllColumns(),
      includePlaycount: true,
    });
    assert.match(row.outerHTML, /data-index="0"/);
    assert.match(renderMobileAlbumCard(data, 0).outerHTML, /data-index="0"/);
    assert.match(row.html, /title="0 plays on Last.fm"/);
    for (const text of [
      data.albumName,
      data.artist,
      data.country,
      data.genre1,
    ]) {
      assert.ok(row.html.includes(`title="${text}"`));
    }
  });
  it('reuses cover/availability parts and inserts trusted internal slots verbatim', () => {
    const badgeHTML = '<span data-test-badge>Badge &amp; text</span>';
    const data = album();
    const desktop = renderDesktopAlbumRow(data, 40, {
      columns: getAllColumns(),
      badgeHTML,
      badgeState: 'raw "state"',
      includePlaycount: true,
      includeAvailabilityLinks: true,
      coverOptions: { loadMode: 'lazy' },
    });
    const mobile = renderMobileAlbumCard(data, 40, {
      badgeHTML,
      badgeState: 'raw "state"',
      coverOptions: { loadMode: 'lazy' },
      includeAvailabilityLinks: true,
      menuHTML: '<span data-test-menu>Menu</span>',
    });
    for (const { html } of [desktop, mobile]) {
      assert.ok(html.includes(badgeHTML));
      assert.match(html, /data-badge-state="raw &quot;state&quot;"/);
      assert.match(html, /loading="lazy"/);
      assert.match(
        html,
        /data-cover-src="\/api\/albums\/album-1\/cover\?size=thumb"/
      );
      assert.match(html, /href="https:\/\/open.spotify.com\/album\/album-1"/);
      assert.doesNotMatch(html, /\son\w+=/);
    }
    assert.match(mobile.html, /<span data-test-menu>Menu<\/span>/);
    assert.match(desktop.html, /data-playcount="item-1"/);
    assert.doesNotMatch(
      renderMobileAlbumCard(data, 0, { includeAvailability: false }).html,
      /album-availability/
    );
    assert.doesNotMatch(
      renderDesktopAlbumRow(data, 0, {
        columns: getAllColumns(),
        includeAvailability: false,
      }).html,
      /album-availability/
    );
    assert.match(
      renderMobileAlbumCard(album({ isDisqualified: true }), 40).html,
      /src="\/shame-go-t.gif"/
    );
  });

  it('escapes raw album fields, tracks, comments, playcounts and attributes without mutating input', () => {
    const attack = '"><script>alert(1)</script>&';
    const fields = [
      'albumName',
      'artist',
      'releaseDate',
      'country',
      'countryDisplay',
      'genre1',
      'genre1Display',
      'genre2',
      'genre2Display',
      'primaryTrack',
      'primaryTrackDisplay',
      'primaryTrackDuration',
      'secondaryTrack',
      'secondaryTrackDisplay',
      'secondaryTrackDuration',
      'comment',
      'comment2',
      'itemId',
      'playcount',
      'coverThumbUrl',
      'coverImageUrl',
    ];
    const data = album(
      Object.fromEntries(fields.map((field) => [field, attack]))
    );
    data.playcountDisplay.html = attack;
    const before = globalThis.structuredClone(data);
    for (const editable of [false, true]) {
      const desktop = renderDesktopAlbumRow(data, attack, {
        columns: getAllColumns(),
        editable,
        includePlaycount: true,
      });
      const mobile = renderMobileAlbumCard(data, attack, {
        editable,
        includePlaycount: true,
        includeTracks: true,
      });
      for (const { outerHTML } of [desktop, mobile]) {
        assert.doesNotMatch(outerHTML, /<script>|\son\w+=/);
        assert.match(
          outerHTML,
          /&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;&amp;/
        );
        assert.doesNotMatch(outerHTML, /&amp;lt;script/);
      }
    }
    assert.deepEqual(data, before);
    const header = renderDesktopAlbumHeader({
      columns: [
        { id: 'album', label: attack, cellClass: 'album-cell', width: '1fr' },
      ],
    });
    assert.doesNotMatch(header.html, /<script>/);
  });
});
