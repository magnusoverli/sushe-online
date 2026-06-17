// Add-album workflow for the SuShe Online extension.

(function () {
  function createAlbumAddService(deps = {}) {
    const chromeApi = deps.chrome || chrome;
    const logger = deps.logger || console;
    const { ACTIONS } = deps.constants || globalThis.ExtensionConstants;
    const {
      showNotification,
      showNotificationWithImage,
      validateAndCleanToken,
      handleUnauthorized,
      ensureStateLoaded,
      getApiBase,
      getAuthHeaders,
      showErrorMenu,
      onAlbumAdded,
    } = deps;
    const albumApi =
      deps.albumApi || globalThis.AlbumApiService.createAlbumApiService(deps);

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
            files: [
              'extension-constants.js',
              'album-identity-service.js',
              'rym-presence-badges.js',
              'content-script.js',
            ],
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

    async function enrichAlbumCountry(apiBase, releaseGroup, albumId) {
      if (!albumId) return;

      const artistCountry = await albumApi.fetchArtistCountry(
        apiBase,
        releaseGroup
      );
      if (!artistCountry) return;

      const response = await albumApi.updateAlbumMetadata(apiBase, [
        { albumId, country: artistCountry },
      ]);

      if (response.status === 401) {
        await handleUnauthorized();
        return;
      }

      if (!response.ok) {
        logger.warn(
          'Could not update album country after add:',
          response.status
        );
      }
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
        const releaseGroup = await albumApi.searchMusicBrainz(
          apiBase,
          albumData
        );
        logger.log('Found release group:', releaseGroup);

        const genres = await genresPromise;
        albumData.genre_1 = genres.genre_1 || '';
        albumData.genre_2 = genres.genre_2 || '';

        const newAlbum = albumApi.buildAlbumPayload(
          albumData,
          releaseGroup,
          ''
        );

        logger.log('Album genres from RYM:', {
          genre_1: albumData.genre_1,
          genre_2: albumData.genre_2,
        });

        logger.log('Adding album to list via PATCH...');
        const saveResponse = await albumApi.saveAlbum(
          apiBase,
          listId,
          newAlbum
        );
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

        await showNotificationWithImage(
          `✅   Added to ${listName}   ✅`,
          `${albumData.album} by ${albumData.artist}`,
          rymCoverUrl
        );

        if (typeof onAlbumAdded === 'function') {
          onAlbumAdded({
            album: newAlbum,
            listId,
            listName,
            tabId: tab.id,
          }).catch((error) => {
            logger.warn('Post-add extension state update failed:', error);
          });
        }

        await enrichAlbumCountry(
          apiBase,
          releaseGroup,
          newAlbum.album_id
        ).catch((error) => {
          logger.warn('Post-add album country enrichment failed:', error);
        });
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
