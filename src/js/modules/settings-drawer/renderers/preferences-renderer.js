/**
 * Settings drawer preferences renderer.
 *
 * Keeps preferences category markup separate from drawer orchestration.
 */

export function createSettingsPreferencesRenderer() {
  function renderPreferencesCategory(data) {
    if (!data.hasData) {
      return `
        <div class="space-y-6">
          <div class="settings-group">
            <h3 class="settings-group-title">Music Preferences</h3>
            <div class="settings-group-content">
              <div class="text-center py-12">
                <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-800 flex items-center justify-center">
                  <i class="fas fa-music text-2xl text-gray-600"></i>
                </div>
                <p class="text-gray-300 font-medium mb-2">No preference data yet</p>
                <p class="text-sm text-gray-500 mb-6 max-w-md mx-auto">Add albums to your lists or connect Spotify/Last.fm to see your music taste analysis.</p>
                <button id="syncPreferencesBtn" class="settings-button">
                  <i class="fas fa-sync-alt mr-2"></i>
                  Sync Now
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    const topGenres = (data.topGenres || []).slice(0, 8);
    const topArtists = (data.topArtists || []).slice(0, 8);
    const topCountries = (data.topCountries || []).slice(0, 6);
    const maxCountryCount = topCountries[0]?.count || 1;
    const genreAffinity = (data.genreAffinity || []).slice(0, 10);
    const artistAffinity = (data.artistAffinity || []).slice(0, 10);

    let updatedText = 'Never';
    if (data.updatedAt) {
      try {
        const date = new Date(data.updatedAt);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) updatedText = 'Just now';
        else if (diffMins < 60)
          updatedText = `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
        else if (diffHours < 24)
          updatedText = `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        else if (diffDays < 7)
          updatedText = `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
        else updatedText = date.toLocaleDateString();
      } catch (_e) {
        updatedText = 'Unknown';
      }
    }

    const hasListData = data.totalAlbums > 0;
    const hasSpotifyData = data.spotify?.syncedAt;
    const hasLastfmData = data.lastfm?.syncedAt;
    const sourceCount = [hasListData, hasSpotifyData, hasLastfmData].filter(
      Boolean
    ).length;

    const getSourceIcons = (sources) => {
      if (!sources || !Array.isArray(sources)) return '';
      return sources
        .map((s) => {
          if (s === 'spotify')
            return '<i class="fab fa-spotify text-green-500" title="Spotify"></i>';
          if (s === 'lastfm')
            return '<i class="fab fa-lastfm text-red-500" title="Last.fm"></i>';
          if (s === 'internal')
            return '<i class="fas fa-list text-gray-400" title="Your lists"></i>';
          return '';
        })
        .join('');
    };

    return `
      <div class="space-y-6">
        <div class="settings-group">
          <h3 class="settings-group-title">Music Preferences</h3>
          <div class="settings-group-content">
            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-gray-800">
              <div class="text-sm text-gray-400">
                <i class="fas fa-clock mr-1.5"></i>
                Updated ${updatedText}
              </div>
              <button id="syncPreferencesBtn" class="settings-button">
                <i class="fas fa-sync-alt mr-2" id="syncIcon"></i>
                <span id="syncText">Sync Now</span>
              </button>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
              <div class="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50 text-center">
                <div class="text-red-500 mb-2">
                  <i class="fas fa-compact-disc text-xl"></i>
                </div>
                <div class="text-2xl font-bold text-white mb-1">${data.totalAlbums || 0}</div>
                <div class="text-xs text-gray-400 uppercase tracking-wide">Albums</div>
              </div>
              <div class="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50 text-center">
                <div class="text-purple-400 mb-2">
                  <i class="fas fa-tags text-xl"></i>
                </div>
                <div class="text-2xl font-bold text-white mb-1">${topGenres.length}</div>
                <div class="text-xs text-gray-400 uppercase tracking-wide">Genres</div>
              </div>
              <div class="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50 text-center">
                <div class="text-blue-400 mb-2">
                  <i class="fas fa-user-friends text-xl"></i>
                </div>
                <div class="text-2xl font-bold text-white mb-1">${topArtists.length}</div>
                <div class="text-xs text-gray-400 uppercase tracking-wide">Artists</div>
              </div>
              <div class="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50 text-center">
                <div class="text-green-400 mb-2">
                  <i class="fas fa-database text-xl"></i>
                </div>
                <div class="text-2xl font-bold text-white mb-1">${sourceCount}</div>
                <div class="text-xs text-gray-400 uppercase tracking-wide">Sources</div>
              </div>
            </div>
          </div>
        </div>

        ${
          topGenres.length > 0
            ? `
        <div class="settings-group">
          <h3 class="settings-group-title">Top Genres</h3>
          <div class="settings-group-content">
            <div class="space-y-2">
              ${topGenres
                .map(
                  (genre, idx) => `
                <div class="flex items-center gap-3 py-2 group hover:bg-gray-800/30 rounded-lg px-2 -mx-2 transition-colors">
                  <div class="w-6 text-sm font-medium text-gray-500">${idx + 1}</div>
                  <div class="flex-1 text-sm text-gray-200 truncate font-medium">${genre.name || genre}</div>
                  ${genre.sources ? `<div class="flex gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity">${getSourceIcons(genre.sources)}</div>` : ''}
                </div>
              `
                )
                .join('')}
            </div>
          </div>
        </div>
        `
            : ''
        }

        ${
          topArtists.length > 0
            ? `
        <div class="settings-group">
          <h3 class="settings-group-title">Top Artists</h3>
          <div class="settings-group-content">
            <div class="space-y-2">
              ${topArtists
                .map(
                  (artist, idx) => `
                <div class="flex items-center gap-3 py-2 group hover:bg-gray-800/30 rounded-lg px-2 -mx-2 transition-colors">
                  <div class="w-6 text-sm font-medium text-gray-500">${idx + 1}</div>
                  <div class="flex-1 text-sm text-gray-200 truncate font-medium">${artist.name || artist}</div>
                  ${artist.sources ? `<div class="flex gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity">${getSourceIcons(artist.sources)}</div>` : ''}
                </div>
              `
                )
                .join('')}
            </div>
          </div>
        </div>
        `
            : ''
        }

        ${
          topCountries.length > 0
            ? `
        <div class="settings-group">
          <h3 class="settings-group-title">Top Countries</h3>
          <div class="settings-group-content">
            <div class="space-y-2">
              ${topCountries
                .map((country, idx) => {
                  const count = country.count || 0;
                  const percentage =
                    maxCountryCount > 0
                      ? Math.round((count / maxCountryCount) * 100)
                      : 0;
                  return `
                  <div class="flex items-center gap-3 py-2 group hover:bg-gray-800/30 rounded-lg px-2 -mx-2 transition-colors">
                    <div class="w-6 text-sm font-medium text-gray-500">${idx + 1}</div>
                    <div class="w-28 sm:w-36 text-sm text-gray-200 truncate font-medium">${country.name || country}</div>
                    <div class="flex-1 h-2.5 bg-gray-800 rounded-full overflow-hidden">
                      <div class="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full transition-all duration-500 ease-out" style="width: ${percentage}%"></div>
                    </div>
                    <div class="w-14 text-right text-xs text-gray-500 tabular-nums">${count} artist${count !== 1 ? 's' : ''}</div>
                  </div>
                `;
                })
                .join('')}
            </div>
          </div>
        </div>
        `
            : ''
        }

        ${
          genreAffinity.length > 0
            ? `
        <div class="settings-group">
          <h3 class="settings-group-title">Genre Affinity</h3>
          <div class="settings-group-content">
            <div class="space-y-2">
              ${genreAffinity
                .map(
                  (genre, idx) => `
                <div class="flex items-center gap-3 py-2 group hover:bg-gray-800/30 rounded-lg px-2 -mx-2 transition-colors">
                  <div class="w-6 text-sm font-medium text-gray-500">${idx + 1}</div>
                  <div class="flex-1 text-sm text-gray-200 truncate font-medium">${genre.name || genre}</div>
                  ${genre.sources ? `<div class="flex gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity">${getSourceIcons(genre.sources)}</div>` : ''}
                </div>
              `
                )
                .join('')}
            </div>
          </div>
        </div>
        `
            : ''
        }

        ${
          artistAffinity.length > 0
            ? `
        <div class="settings-group">
          <h3 class="settings-group-title">Artist Affinity</h3>
          <div class="settings-group-content">
            <div class="space-y-2">
              ${artistAffinity
                .map(
                  (artist, idx) => `
                <div class="flex items-center gap-3 py-2 group hover:bg-gray-800/30 rounded-lg px-2 -mx-2 transition-colors">
                  <div class="w-6 text-sm font-medium text-gray-500">${idx + 1}</div>
                  <div class="flex-1 text-sm text-gray-200 truncate font-medium">${artist.name || artist}</div>
                  ${artist.sources ? `<div class="flex gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity">${getSourceIcons(artist.sources)}</div>` : ''}
                </div>
              `
                )
                .join('')}
            </div>
          </div>
        </div>
        `
            : ''
        }

        ${
          data.lastfm?.totalScrobbles > 0
            ? `
        <div class="settings-group">
          <h3 class="settings-group-title">Last.fm Statistics</h3>
          <div class="settings-group-content">
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Total Scrobbles</label>
                <p class="settings-description">From Last.fm</p>
              </div>
              <div class="settings-row-control">
                <span class="settings-stat-value">${data.lastfm.totalScrobbles.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>
        `
            : ''
        }

        ${(() => {
          const spotifyArtistsByRange = data.spotify?.topArtistsByRange || {};
          const spotifyTracksByRange = data.spotify?.topTracksByRange || {};
          const spotifyRanges = [
            'short_term',
            'medium_term',
            'long_term',
          ].filter(
            (r) =>
              spotifyArtistsByRange[r]?.length > 0 ||
              spotifyTracksByRange[r]?.length > 0
          );

          if (spotifyRanges.length === 0) return '';

          const defaultSpotifyRange = spotifyRanges.includes('medium_term')
            ? 'medium_term'
            : spotifyRanges[0];
          const TIME_RANGE_LABELS = {
            short_term: '4 Weeks',
            medium_term: '6 Months',
            long_term: 'All Time',
          };

          const renderSpotifyArtist = (artist, rank, country = null) => {
            const countryDisplay = country
              ? `<span class="text-gray-500 text-xs" title="${country}">· ${country}</span>`
              : '';
            return `
              <div class="flex items-center gap-3 py-2 group hover:bg-gray-800/30 rounded-lg px-2 -mx-2 transition-colors">
                <div class="w-6 text-sm font-medium text-gray-500">${rank}</div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-sm text-gray-200 truncate font-medium" title="${artist.name || artist}">${artist.name || artist}</span>
                    ${countryDisplay}
                  </div>
                </div>
              </div>
            `;
          };

          const renderSpotifyTrack = (track, rank) => {
            return `
              <div class="flex items-center gap-3 py-2 group hover:bg-gray-800/30 rounded-lg px-2 -mx-2 transition-colors">
                <div class="w-6 text-sm font-medium text-gray-500">${rank}</div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-sm text-gray-200 truncate font-medium" title="${track.name}">${track.name}</span>
                    <span class="text-gray-500 text-xs truncate" title="${track.artist}">· ${track.artist}</span>
                  </div>
                </div>
              </div>
            `;
          };

          return `
        <div class="settings-group">
          <h3 class="settings-group-title">Spotify</h3>
          <div class="settings-group-content">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div class="text-sm text-gray-400">
                ${data.spotify?.syncedAt ? `Synced ${updatedText}` : ''}
              </div>
              <div class="flex gap-1.5 flex-wrap" id="spotifyRangeButtons">
                ${spotifyRanges
                  .map((r) => {
                    const isActive = r === defaultSpotifyRange;
                    const activeClass = isActive
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600';
                    return `<button class="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${activeClass}" data-service="spotify" data-range="${r}">${TIME_RANGE_LABELS[r]}</button>`;
                  })
                  .join('')}
              </div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <h5 class="text-xs text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                  <i class="fas fa-user-friends"></i>
                  Top Artists
                </h5>
                ${spotifyRanges
                  .map((range) => {
                    const artists = spotifyArtistsByRange[range] || [];
                    return `
                    <div class="space-y-0.5 ${range !== defaultSpotifyRange ? 'hidden' : ''}" data-service="spotify" data-type="artists" data-range="${range}" data-content="true">
                      ${artists
                        .slice(0, 8)
                        .map((a, i) => renderSpotifyArtist(a, i + 1, a.country))
                        .join('')}
                    </div>
                  `;
                  })
                  .join('')}
              </div>

              <div>
                <h5 class="text-xs text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                  <i class="fas fa-music"></i>
                  Top Tracks
                </h5>
                ${spotifyRanges
                  .map((range) => {
                    const tracks = spotifyTracksByRange[range] || [];
                    return `
                    <div class="space-y-0.5 ${range !== defaultSpotifyRange ? 'hidden' : ''}" data-service="spotify" data-type="tracks" data-range="${range}" data-content="true">
                      ${tracks
                        .slice(0, 8)
                        .map((t, i) => renderSpotifyTrack(t, i + 1))
                        .join('')}
                    </div>
                  `;
                  })
                  .join('')}
              </div>
            </div>
          </div>
        </div>
        `;
        })()}

        ${(() => {
          const lastfmArtistsByRange = data.lastfm?.topArtistsByRange || {};
          const lastfmRanges = [
            '7day',
            '1month',
            '3month',
            '6month',
            '12month',
            'overall',
          ].filter((r) => lastfmArtistsByRange[r]?.length > 0);

          if (lastfmRanges.length === 0) return '';

          const defaultLastfmRange = lastfmRanges.includes('overall')
            ? 'overall'
            : lastfmRanges[0];
          const TIME_RANGE_LABELS = {
            '7day': '7 Days',
            '1month': '1 Month',
            '3month': '3 Months',
            '6month': '6 Months',
            '12month': '1 Year',
            overall: 'All Time',
          };

          const renderLastfmArtist = (artist, rank, maxPlaycount) => {
            const playcount = artist.playcount || 0;
            const percentage =
              maxPlaycount > 0
                ? Math.round((playcount / maxPlaycount) * 100)
                : 0;
            const countryDisplay = artist.country
              ? `<span class="text-gray-500 text-xs" title="${artist.country}">· ${artist.country}</span>`
              : '';
            return `
              <div class="flex items-center gap-3 py-2 group hover:bg-gray-800/30 rounded-lg px-2 -mx-2 transition-colors">
                <div class="w-6 text-sm font-medium text-gray-500">${rank}</div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-sm text-gray-200 truncate font-medium" title="${artist.name}">${artist.name}</span>
                    ${countryDisplay}
                  </div>
                  <div class="h-2 bg-gray-800 rounded-full overflow-hidden mt-1">
                    <div class="h-full bg-gradient-to-r from-red-500 to-red-400 rounded-full transition-all duration-500 ease-out" style="width: ${percentage}%"></div>
                  </div>
                </div>
                <div class="w-16 text-right text-xs text-gray-500 tabular-nums">${playcount.toLocaleString()}</div>
              </div>
            `;
          };

          return `
        <div class="settings-group">
          <h3 class="settings-group-title">Last.fm</h3>
          <div class="settings-group-content">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div class="text-sm text-gray-400">
                ${data.lastfm?.syncedAt ? `Synced ${updatedText}` : ''}
                ${data.lastfm?.totalScrobbles > 0 ? `· ${data.lastfm.totalScrobbles.toLocaleString()} scrobbles` : ''}
              </div>
              <div class="flex gap-1.5 flex-wrap" id="lastfmRangeButtons">
                ${lastfmRanges
                  .map((r) => {
                    const isActive = r === defaultLastfmRange;
                    const activeClass = isActive
                      ? 'bg-red-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600';
                    return `<button class="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${activeClass}" data-service="lastfm" data-range="${r}">${TIME_RANGE_LABELS[r]}</button>`;
                  })
                  .join('')}
              </div>
            </div>

            <div>
              <h5 class="text-xs text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                <i class="fas fa-user-friends"></i>
                Top Artists
                <span class="text-gray-500 font-normal normal-case">(by play count)</span>
              </h5>
              ${lastfmRanges
                .map((range) => {
                  const artists = lastfmArtistsByRange[range] || [];
                  const maxPlaycount = artists[0]?.playcount || 1;
                  return `
                  <div class="space-y-0.5 ${range !== defaultLastfmRange ? 'hidden' : ''}" data-service="lastfm" data-type="artists" data-range="${range}" data-content="true">
                    ${artists
                      .slice(0, 8)
                      .map((a, i) => renderLastfmArtist(a, i + 1, maxPlaycount))
                      .join('')}
                  </div>
                `;
                })
                .join('')}
            </div>
          </div>
        </div>
        `;
        })()}
      </div>
    `;
  }

  return {
    renderPreferencesCategory,
  };
}
