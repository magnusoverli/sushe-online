(function () {
  function identityKey(album) {
    return `${album?.artist || ''}\u0000${album?.album || ''}`
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

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
    const albumIdentity = deps.albumIdentity || globalThis.AlbumIdentity;
    const enrichment =
      deps.enrichment ||
      globalThis.AlbumAddEnrichment.createAlbumAddEnrichment({
        albumApi,
        handleUnauthorized,
        logger,
      });

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
              'rym-album-extractor.js',
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

    function getClickedIdentity(info) {
      for (const url of [info.linkUrl, info.pageUrl]) {
        const identity = albumIdentity?.getAlbumIdentityFromUrl?.(url);
        if (identity) return identity;
      }
      return null;
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

        const clickedIdentity = getClickedIdentity(info);
        const speculativeMusicBrainz = clickedIdentity
          ? albumApi
              .searchMusicBrainz(apiBase, clickedIdentity)
              .then((releaseGroup) => ({ releaseGroup }))
              .catch((error) => ({ error }))
          : null;
        let albumData = await extractAlbumIdentity(info, tab);

        if (!albumData || albumData.error) {
          const urlIdentity = clickedIdentity;
          if (urlIdentity) {
            albumData = {
              ...urlIdentity,
              genre_1: '',
              genre_2: '',
            };
          } else {
            logger.error('Content script returned error:', albumData?.error);
            throw new Error(
              albumData?.error ||
                'Failed to extract album data. Make sure you are on an album page.'
            );
          }
        }

        if (!albumData.artist || !albumData.album) {
          logger.error('Invalid album data received:', albumData);
          throw new Error(
            `Could not extract album information from page. Artist: "${albumData?.artist}", Album: "${albumData?.album}"`
          );
        }

        logger.log('Extracted album data:', albumData);
        const observationRetry = enrichment.startObservationRetry(
          albumData,
          () => extractAlbumIdentity(info, tab)
        );

        logger.log('Searching MusicBrainz for album...');
        let releaseGroup;
        if (
          speculativeMusicBrainz &&
          identityKey(clickedIdentity) === identityKey(albumData)
        ) {
          const speculativeResult = await speculativeMusicBrainz;
          if (speculativeResult.error) {
            logger.warn(
              'Speculative MusicBrainz lookup failed; retrying with extracted data:',
              speculativeResult.error
            );
            releaseGroup = await albumApi.searchMusicBrainz(apiBase, albumData);
          } else {
            releaseGroup = speculativeResult.releaseGroup;
          }
        } else {
          releaseGroup = await albumApi.searchMusicBrainz(apiBase, albumData);
        }
        logger.log('Found release group:', releaseGroup);
        let observationAppliedBeforeSave = false;
        if (observationRetry?.value) {
          albumData = { ...albumData, ...observationRetry.value };
          observationAppliedBeforeSave = true;
        }
        const countryPromise = albumApi.fetchArtistCountry(
          apiBase,
          releaseGroup
        );

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
        const canonicalAlbumId =
          result.addedItems?.[0]?.album_id ||
          result.duplicates?.[0]?.album_id ||
          newAlbum.album_id;
        const observationPersistenceTask =
          observationRetry?.promise && !observationAppliedBeforeSave
            ? enrichment.persistObservation({
                apiBase,
                albumId: canonicalAlbumId,
                retryPromise: observationRetry.promise,
              })
            : null;

        if (result.duplicates && result.duplicates.length > 0) {
          logger.log('Album already exists in list');
          showNotificationWithImage(
            `⚠️   Already in ${listName}   ⚠️`,
            `${albumData.album} by ${albumData.artist}`,
            rymCoverUrl
          );
          await observationPersistenceTask?.catch((error) => {
            logger.warn('Post-add RYM observation retry failed:', error);
          });
          return;
        }

        await showNotificationWithImage(
          `✅   Added to ${listName}   ✅`,
          `${albumData.album} by ${albumData.artist}`,
          rymCoverUrl
        );

        const canonicalAlbum = {
          ...newAlbum,
          ...(result.addedItems?.[0] || {}),
        };
        const postAddTasks = [
          enrichment.enrichCountry(
            apiBase,
            countryPromise,
            canonicalAlbum.album_id
          ),
        ];
        if (observationPersistenceTask) {
          postAddTasks.push(observationPersistenceTask);
        }
        if (typeof onAlbumAdded === 'function') {
          postAddTasks.push(
            onAlbumAdded({
              album: canonicalAlbum,
              listId,
              listName,
              tabId: tab.id,
            })
          );
        }
        const postAddResults = await Promise.allSettled(postAddTasks);
        postAddResults.forEach((postAddResult) => {
          if (postAddResult.status === 'rejected') {
            logger.warn('Post-add enrichment failed:', postAddResult.reason);
          }
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
  globalThis.AlbumAddService = { createAlbumAddService };
})();
