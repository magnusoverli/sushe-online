// MusicBrainz and SuShe API helpers for extension album additions.

(function () {
  function copyOptionalTaxonomyArrays(taxonomy) {
    return Object.fromEntries(
      ['languages', 'scenes', 'movements']
        .filter((field) => Object.hasOwn(taxonomy || {}, field))
        .map((field) => [field, taxonomy[field] || []])
    );
  }

  function createAlbumApiService(deps = {}) {
    const logger = deps.logger || console;
    const { API } = deps.constants || globalThis.ExtensionConstants;
    const { fetchWithTimeout, getAuthHeaders, handleUnauthorized } = deps;

    const artistCountryCache = new Map();
    const maxArtistCountryCacheSize = 100;

    function rememberArtistCountry(artistId, country) {
      if (!artistId) return;
      if (artistCountryCache.size >= maxArtistCountryCacheSize) {
        const oldestKey = artistCountryCache.keys().next().value;
        artistCountryCache.delete(oldestKey);
      }
      artistCountryCache.set(artistId, country || '');
    }

    async function searchMusicBrainz(apiBase, albumData) {
      const searchQuery = `${albumData.artist} ${albumData.album}`;
      const mbEndpoint = `release-group/?query=${searchQuery}&type=album|ep&fmt=json&limit=5`;

      const mbResponse = await fetchWithTimeout(
        `${apiBase}${API.MUSICBRAINZ_PROXY}?endpoint=${encodeURIComponent(mbEndpoint)}&priority=high`,
        { headers: getAuthHeaders() },
        15000
      );

      if (mbResponse.status === 401) {
        await handleUnauthorized();
        throw new Error('Authentication failed. Please login again.');
      }

      if (!mbResponse.ok) throw new Error('Failed to search MusicBrainz');

      const mbData = await mbResponse.json();
      const releaseGroups = mbData['release-groups'] || [];

      if (releaseGroups.length === 0) {
        throw new Error(
          'Album not found in MusicBrainz. Try adding manually in SuShe Online.'
        );
      }

      return releaseGroups[0];
    }

    async function fetchArtistCountry(apiBase, releaseGroup) {
      if (
        !releaseGroup['artist-credit'] ||
        releaseGroup['artist-credit'].length === 0
      ) {
        return '';
      }

      const artistId = releaseGroup['artist-credit'][0].artist.id;
      try {
        if (artistCountryCache.has(artistId)) {
          return artistCountryCache.get(artistId);
        }

        const artistEndpoint = `artist/${artistId}?fmt=json`;
        const artistResponse = await fetchWithTimeout(
          `${apiBase}${API.MUSICBRAINZ_PROXY}?endpoint=${encodeURIComponent(artistEndpoint)}&priority=normal`,
          { headers: getAuthHeaders() },
          15000
        );

        if (!artistResponse.ok) return '';

        const artistData = await artistResponse.json();
        const artistCountry = artistData.country || '';
        rememberArtistCountry(artistId, artistCountry);
        if (artistCountry)
          logger.log(`Got artist country code: ${artistCountry}`);
        return artistCountry;
      } catch (error) {
        logger.warn('Could not fetch artist country:', error);
        return '';
      }
    }

    function buildAlbumPayload(albumData, releaseGroup, artistCountry) {
      const sourceObservation = albumData.sourceObservation
        ? {
            schemaVersion: 1,
            identity: {
              numericId:
                albumData.sourceObservation.identity?.numericId == null
                  ? null
                  : String(albumData.sourceObservation.identity.numericId),
              canonicalUrl:
                albumData.sourceObservation.identity?.canonicalUrl || null,
              canonicalPath:
                albumData.sourceObservation.identity?.canonicalPath || null,
              artist: albumData.sourceObservation.identity?.artist || '',
              title: albumData.sourceObservation.identity?.title || '',
            },
            platformLinks: (
              albumData.sourceObservation.platformLinks || []
            ).map((link) => ({ service: link.service, url: link.url })),
            taxonomy: {
              complete: albumData.sourceObservation.taxonomy?.complete === true,
              primaryGenres:
                albumData.sourceObservation.taxonomy?.primaryGenres || [],
              secondaryGenres:
                albumData.sourceObservation.taxonomy?.secondaryGenres || [],
              descriptors:
                albumData.sourceObservation.taxonomy?.descriptors || [],
              ...copyOptionalTaxonomyArrays(
                albumData.sourceObservation.taxonomy
              ),
              sourceUrl:
                albumData.sourceObservation.taxonomy?.sourceUrl || null,
              extractorVersion:
                albumData.sourceObservation.taxonomy?.extractorVersion || '',
              capturedAt:
                albumData.sourceObservation.taxonomy?.capturedAt || null,
            },
          }
        : null;

      return {
        artist: albumData.artist,
        album: albumData.album,
        album_id: releaseGroup.id || '',
        release_date: releaseGroup['first-release-date'] || '',
        country: artistCountry,
        genre_1: albumData.genre_1 || '',
        genre_2: albumData.genre_2 || '',
        ...(sourceObservation ? { sourceObservation } : {}),
        comments: '',
        tracks: null,
        primary_track: null,
        secondary_track: null,
      };
    }

    async function updateAlbumMetadata(apiBase, updates) {
      return fetchWithTimeout(
        `${apiBase}${API.ALBUM_BATCH_UPDATE}`,
        {
          method: 'PATCH',
          headers: getAuthHeaders(),
          body: JSON.stringify({ updates }),
        },
        15000
      );
    }

    async function saveAlbum(apiBase, listId, newAlbum) {
      return fetchWithTimeout(
        `${apiBase}${API.LISTS}/${encodeURIComponent(listId)}/items`,
        {
          method: 'PATCH',
          headers: getAuthHeaders(),
          body: JSON.stringify({ added: [newAlbum] }),
        },
        15000
      );
    }

    return {
      buildAlbumPayload,
      fetchArtistCountry,
      saveAlbum,
      searchMusicBrainz,
      updateAlbumMetadata,
    };
  }

  globalThis.AlbumApiService = { createAlbumApiService };
})();
