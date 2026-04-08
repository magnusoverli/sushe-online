const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

describe('settings preferences renderer', () => {
  let createSettingsPreferencesRenderer;

  beforeEach(async () => {
    const module =
      await import('../src/js/modules/settings-drawer/renderers/preferences-renderer.js');
    createSettingsPreferencesRenderer =
      module.createSettingsPreferencesRenderer;
  });

  it('renders empty-state content when no preference data exists', () => {
    const { renderPreferencesCategory } = createSettingsPreferencesRenderer();

    const html = renderPreferencesCategory({ hasData: false });

    assert.match(html, /No preference data yet/);
    assert.match(html, /id="syncPreferencesBtn"/);
    assert.doesNotMatch(html, /id="spotifyRangeButtons"/);
  });

  it('renders spotify and lastfm sections when ranged data exists', () => {
    const { renderPreferencesCategory } = createSettingsPreferencesRenderer();

    const html = renderPreferencesCategory({
      hasData: true,
      updatedAt: new Date().toISOString(),
      totalAlbums: 12,
      topGenres: [{ name: 'Rock', sources: ['spotify', 'internal'] }],
      topArtists: [{ name: 'Artist One', sources: ['lastfm'] }],
      topCountries: [{ name: 'United States', count: 4 }],
      genreAffinity: [{ name: 'Rock', sources: ['spotify'] }],
      artistAffinity: [{ name: 'Artist One', sources: ['lastfm'] }],
      spotify: {
        syncedAt: new Date().toISOString(),
        topArtistsByRange: {
          medium_term: [{ name: 'A', country: 'US' }],
        },
        topTracksByRange: {
          medium_term: [{ name: 'T', artist: 'A' }],
        },
      },
      lastfm: {
        syncedAt: new Date().toISOString(),
        totalScrobbles: 1234,
        topArtistsByRange: {
          overall: [{ name: 'LF A', playcount: 50, country: 'SE' }],
        },
      },
    });

    assert.match(html, /Top Genres/);
    assert.match(html, /Top Artists/);
    assert.match(html, /Top Countries/);
    assert.match(html, /Spotify/);
    assert.match(html, /Last\.fm/);
    assert.match(html, /id="spotifyRangeButtons"/);
    assert.match(html, /id="lastfmRangeButtons"/);
    assert.match(html, /fab fa-spotify/);
    assert.match(html, /fab fa-lastfm/);
    assert.match(html, /Total Scrobbles/);
  });

  it('omits spotify and lastfm range sections when ranged data is absent', () => {
    const { renderPreferencesCategory } = createSettingsPreferencesRenderer();

    const html = renderPreferencesCategory({
      hasData: true,
      totalAlbums: 2,
      topGenres: [],
      topArtists: [],
      topCountries: [],
      genreAffinity: [],
      artistAffinity: [],
      spotify: {
        syncedAt: new Date().toISOString(),
        topArtistsByRange: {},
        topTracksByRange: {},
      },
      lastfm: {
        syncedAt: new Date().toISOString(),
        totalScrobbles: 0,
        topArtistsByRange: {},
      },
    });

    assert.doesNotMatch(html, /id="spotifyRangeButtons"/);
    assert.doesNotMatch(html, /id="lastfmRangeButtons"/);
    assert.doesNotMatch(html, /Last\.fm Statistics/);
  });
});
