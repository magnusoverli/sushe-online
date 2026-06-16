// Add-album workflow for the SuShe Online extension.

(function () {
  function createAlbumAddService(deps = {}) {
    const chromeApi = deps.chrome || chrome;
    const logger = deps.logger || console;
    const { ACTIONS, API } = deps.constants || globalThis.ExtensionConstants;
    const fetchWithTimeout = deps.fetchWithTimeout;
    const showNotification = deps.showNotification;
    const showNotificationWithImage = deps.showNotificationWithImage;
    const validateAndCleanToken = deps.validateAndCleanToken;
    const handleUnauthorized = deps.handleUnauthorized;
    const ensureStateLoaded = deps.ensureStateLoaded;
    const getApiBase = deps.getApiBase;
    const getAuthHeaders = deps.getAuthHeaders;
    const showErrorMenu = deps.showErrorMenu;

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

    async function extractAlbumIdentity(info, tab) {
      try {
        return await chromeApi.tabs.sendMessage(tab.id, {
          action: ACTIONS.EXTRACT_ALBUM_IDENTITY,
          srcUrl: info.srcUrl,
          linkUrl: info.linkUrl,
          pageUrl: info.pageUrl,
        });
      } catch (err) {
        logger.log('Content script not ready, injecting...', err.message);
        try {
          await chromeApi.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content-script.js'],
          });
          await new Promise((resolve) => setTimeout(resolve, 200));
          return await chromeApi.tabs.sendMessage(tab.id, {
            action: ACTIONS.EXTRACT_ALBUM_IDENTITY,
            srcUrl: info.srcUrl,
            linkUrl: info.linkUrl,
            pageUrl: info.pageUrl,
          });
        } catch (injectErr) {
          logger.error('Failed to inject content script:', injectErr.message);
          throw new Error(
            'Could not communicate with page. Try refreshing RateYourMusic.',
            { cause: injectErr }
          );
        }
      }
    }

    function fetchFallbackGenres(tab, albumData) {
      if (albumData.genre_1) {
        return Promise.resolve({
          genre_1: albumData.genre_1,
          genre_2: albumData.genre_2,
        });
      }

      return chromeApi.tabs
        .sendMessage(tab.id, {
          action: ACTIONS.FETCH_GENRES_FOR_ALBUM,
          albumUrl: albumData.albumUrl,
        })
        .catch((error) => {
          logger.warn('Could not fetch fallback RYM genres:', error);
          return { genre_1: '', genre_2: '' };
        });
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

      if (!mbResponse.ok) {
        throw new Error('Failed to search MusicBrainz');
      }

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
        if (artistCountry) {
          logger.log(`Got artist country code: ${artistCountry}`);
        }
        return artistCountry;
      } catch (error) {
        logger.warn('Could not fetch artist country:', error);
        return '';
      }
    }

    function buildAlbumPayload(albumData, releaseGroup, artistCountry) {
      return {
        artist: albumData.artist,
        album: albumData.album,
        album_id: releaseGroup.id || '',
        release_date: releaseGroup['first-release-date'] || '',
        country: artistCountry,
        genre_1: albumData.genre_1 || '',
        genre_2: albumData.genre_2 || '',
        comments: '',
        tracks: null,
        primary_track: null,
        secondary_track: null,
      };
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

    async function addAlbumToList(info, tab, listId, listName) {
      await ensureStateLoaded();
      const apiBase = getApiBase();
      logger.log('In-memory state:', {
        apiUrl: apiBase,
        hasToken: !!getAuthHeaders().Authorization,
      });

      if (!apiBase) {
        showNotification(
          'Not configured',
          'Please click the extension icon and configure your SuShe Online URL.'
        );
        return;
      }

      const validation = await validateAndCleanToken();
      if (!validation.valid) {
        showNotification(
          'Not logged in',
          'Please click the extension icon and login to SuShe Online.'
        );
        await showErrorMenu('Not logged in');
        return;
      }

      try {
        const rymCoverUrl = info.srcUrl || 'icons/icon128.png';
        logger.log('Sending message to content script...');

        const albumData = await extractAlbumIdentity(info, tab);

        if (!albumData || albumData.error) {
          logger.error('Content script returned error:', albumData?.error);
          throw new Error(
            albumData?.error ||
              'Failed to extract album data. Make sure you are on an album page.'
          );
        }

        if (!albumData.artist || !albumData.album) {
          logger.error('Invalid album data received:', albumData);
          throw new Error(
            `Could not extract album information from page. Artist: "${albumData?.artist}", Album: "${albumData?.album}"`
          );
        }

        logger.log('Extracted album data:', albumData);

        const genresPromise = fetchFallbackGenres(tab, albumData);
        logger.log('Searching MusicBrainz for album...');
        const releaseGroup = await searchMusicBrainz(apiBase, albumData);
        logger.log('Found release group:', releaseGroup);

        const artistCountry = await fetchArtistCountry(apiBase, releaseGroup);
        const genres = await genresPromise;
        albumData.genre_1 = genres.genre_1 || '';
        albumData.genre_2 = genres.genre_2 || '';

        const newAlbum = buildAlbumPayload(
          albumData,
          releaseGroup,
          artistCountry
        );

        logger.log('Album genres from RYM:', {
          genre_1: albumData.genre_1,
          genre_2: albumData.genre_2,
        });

        logger.log('Adding album to list via PATCH...');
        const saveResponse = await saveAlbum(apiBase, listId, newAlbum);
        logger.log('Save response status:', saveResponse.status);

        if (!saveResponse.ok) {
          const errorText = await saveResponse.text();
          logger.error('Save failed:', errorText);

          if (saveResponse.status === 401) {
            await handleUnauthorized();
            await showErrorMenu('Not logged in');
            throw new Error(
              'Not authenticated. Please click the extension icon and login again.'
            );
          }

          let errorData;
          try {
            errorData = JSON.parse(errorText);
          } catch {
            throw new Error(
              `Failed to add album (HTTP ${saveResponse.status})`
            );
          }
          throw new Error(errorData.error || 'Failed to add album');
        }

        const result = await saveResponse.json();
        logger.log('Add result:', result);

        if (result.duplicates && result.duplicates.length > 0) {
          logger.log('Album already exists in list');
          showNotificationWithImage(
            `⚠️   Already in ${listName}   ⚠️`,
            `${albumData.album} by ${albumData.artist}`,
            rymCoverUrl
          );
          return;
        }

        showNotificationWithImage(
          `✅   Added to ${listName}   ✅`,
          `${albumData.album} by ${albumData.artist}`,
          rymCoverUrl
        );
      } catch (error) {
        logger.error('Error adding album:', error);
        showNotification(
          '❌ Error',
          error.message || 'Failed to add album to list'
        );
      }
    }

    return { addAlbumToList };
  }

  globalThis.AlbumAddService = {
    createAlbumAddService,
  };
})();
