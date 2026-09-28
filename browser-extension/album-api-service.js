// MusicBrainz and SuShe API helpers for extension album additions.

(function () {
  function copyOptionalTaxonomyFields(taxonomy) {
    return Object.fromEntries(
      ['languages', 'scenes', 'movements', 'releaseType', 'labels', 'credits']
        .filter((field) => Object.hasOwn(taxonomy || {}, field))
        .map((field) => [field, taxonomy[field]])
    );
  }

  function buildSourceObservation(observation) {
    if (!observation) return null;
    const { identity = {}, taxonomy = {}, platformLinks = [] } = observation;
    return {
      schemaVersion: 1,
      identity: {
        numericId:
          identity.numericId == null ? null : String(identity.numericId),
        canonicalUrl: identity.canonicalUrl || null,
        canonicalPath: identity.canonicalPath || null,
        artist: identity.artist || '',
        title: identity.title || '',
      },
      platformLinks: platformLinks.map(({ service, url }) => ({
        service,
        url,
      })),
      taxonomy: {
        complete: taxonomy.complete === true,
        primaryGenres: taxonomy.primaryGenres || [],
        secondaryGenres: taxonomy.secondaryGenres || [],
        descriptors: taxonomy.descriptors || [],
        ...copyOptionalTaxonomyFields(taxonomy),
        sourceUrl: taxonomy.sourceUrl || null,
        extractorVersion: taxonomy.extractorVersion || '',
        capturedAt: taxonomy.capturedAt || null,
      },
    };
  }

  function createAlbumApiService(deps = {}) {
    const logger = deps.logger || console;
    const { API } = deps.constants || globalThis.ExtensionConstants;
    const { fetchWithTimeout, getAuthHeaders, handleUnauthorized } = deps;

    async function searchMusicBrainz(apiBase, albumData) {
      const searchQuery = `${albumData.artist} ${albumData.album}`;
      const mbEndpoint = `release-group/?query=${encodeURIComponent(searchQuery)}&type=album|ep&fmt=json&limit=5`;

      const mbResponse = await fetchWithTimeout(
        `${apiBase}${API.MUSICBRAINZ_PROXY}?endpoint=${encodeURIComponent(mbEndpoint)}&priority=high`,
        { headers: getAuthHeaders() },
        15000
      );

      if (mbResponse.status === 401) {
        await handleUnauthorized();
        throw new Error('Authentication failed. Please login again.');
      }

      if (!mbResponse.ok)
        throw await globalThis.SharedUtils.readApiError(
          mbResponse,
          'Failed to search MusicBrainz'
        );

      const mbData = await mbResponse.json();
      const releaseGroups = mbData['release-groups'] || [];

      if (releaseGroups.length === 0) {
        throw new Error(
          'Album not found in MusicBrainz. Try adding manually in SuShe Online.'
        );
      }

      const normalize = globalThis.AlbumIdentity.normalizeForMatch;
      const matches = releaseGroups.filter((group) => {
        const credits = group['artist-credit'] || [];
        const artist = credits
          .map(
            (credit) =>
              `${credit.name || credit.artist?.name || ''}${credit.joinphrase || ''}`
          )
          .join('');
        return (
          group.id &&
          normalize(group.title) === normalize(albumData.album) &&
          normalize(artist) === normalize(albumData.artist)
        );
      });
      const unique = [
        ...new Map(matches.map((group) => [group.id, group])).values(),
      ];
      if (unique.length !== 1)
        throw new Error(
          unique.length
            ? 'Ambiguous MusicBrainz match. Choose the album manually in SuShe Online.'
            : 'No matching MusicBrainz album. Choose the album manually in SuShe Online.'
        );
      return unique[0];
    }

    async function fetchArtistCountry(apiBase, releaseGroup) {
      if (
        !releaseGroup['artist-credit'] ||
        releaseGroup['artist-credit'].length === 0
      ) {
        return '';
      }

      const artistId = releaseGroup['artist-credit'][0]?.artist?.id;
      if (!artistId) return '';
      try {
        const artistEndpoint = `artist/${artistId}?fmt=json`;
        const artistResponse = await fetchWithTimeout(
          `${apiBase}${API.MUSICBRAINZ_PROXY}?endpoint=${encodeURIComponent(artistEndpoint)}&priority=normal`,
          { headers: getAuthHeaders() },
          15000
        );

        if (artistResponse.status === 401) await handleUnauthorized();
        if (!artistResponse.ok) return '';

        const artistData = await artistResponse.json();
        return artistData.country || '';
      } catch (error) {
        logger.warn('Could not fetch artist country:', error);
        return '';
      }
    }

    function buildAlbumPayload(albumData, releaseGroup, artistCountry) {
      const sourceObservation = buildSourceObservation(
        albumData.sourceObservation
      );

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

    async function updateSourceObservation(
      apiBase,
      albumId,
      sourceObservation
    ) {
      return fetchWithTimeout(
        `${apiBase}${API.ALBUMS}/${encodeURIComponent(albumId)}/source-observation`,
        {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify({ sourceObservation }),
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
      updateSourceObservation,
    };
  }

  globalThis.AlbumApiService = { createAlbumApiService };
})();
