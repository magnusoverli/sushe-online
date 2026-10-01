// Album additions hold one immutable account scope through save and enrichment.
(function () {
  async function extractIdentity(chrome, actions, info, tab) {
    const message = {
      action: actions.EXTRACT_ALBUM_IDENTITY,
      srcUrl: info.srcUrl,
      linkUrl: info.linkUrl,
      pageUrl: info.pageUrl,
    };
    try {
      return await chrome.tabs.sendMessage(tab.id, message);
    } catch {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: [
            'extension-constants.js',
            'shared-utils.js',
            'album-identity-service.js',
            'rym-album-extractor.js',
            'rym-presence-badges.js',
            'content-script.js',
          ],
        });
        return await chrome.tabs.sendMessage(tab.id, message);
      } catch (cause) {
        throw new Error(
          'Could not communicate with page. Try refreshing RateYourMusic.',
          { cause }
        );
      }
    }
  }

  async function resolveRelease(
    api,
    apiBase,
    album,
    clicked,
    speculative,
    logger
  ) {
    const key = (value) => globalThis.AlbumIdentity.getAlbumKey(value);
    if (speculative && key(clicked) === key(album)) {
      const result = await speculative;
      if (!result.error) return result.releaseGroup;
      logger.warn(
        'Speculative lookup failed; retrying extracted identity:',
        result.error.message
      );
    }
    return api.searchMusicBrainz(apiBase, album);
  }

  function validateExtractedAlbum(album, selected, identity) {
    if (album?.error || !album?.artist || !album?.album)
      throw new Error(
        album?.error ||
          'Could not identify this album. Open its RYM album page and try again.'
      );
    if (!identity.identitiesMatch(selected, album))
      throw new Error(
        'The extracted album does not match the selected link. Please try again.'
      );
  }

  function getInitialAlbumIdentity(identity, info) {
    const clicked = identity.getAlbumIdentityFromUrl(
      info.linkUrl || info.pageUrl
    );
    // An unsupported release link cannot be reinterpreted as album artwork.
    if (!clicked && (!info.srcUrl || /\/release\//i.test(info.linkUrl || '')))
      identity.getContextAlbumIdentity(info);
    return clicked;
  }

  async function finishAddition({
    deps,
    enrichment,
    scope,
    album,
    result,
    retry,
    country,
    info,
    tab,
    listId,
    listName,
  }) {
    scope.assertCurrent();
    const duplicate = !!result.duplicates?.length;
    const canonical = {
      ...album,
      ...(result.addedItems?.[0] || result.duplicates?.[0] || {}),
    };
    const tasks = [
      enrichment.enrichCountry(scope.apiBase, country, canonical.album_id),
    ];
    if (retry)
      tasks.push(
        enrichment.persistObservation({
          apiBase: scope.apiBase,
          albumId: canonical.album_id,
          retryPromise: retry.promise,
        })
      );
    if (deps.onAlbumAdded)
      tasks.push(
        deps.onAlbumAdded({
          album: canonical,
          listId,
          listName,
          tabId: tab.id,
          added: !duplicate,
          scope,
        })
      );
    tasks.push(
      deps.showNotificationWithImage(
        duplicate
          ? `⚠️   Already in ${listName}   ⚠️`
          : `✅   Added to ${listName}   ✅`,
        `${canonical.album} by ${canonical.artist}`,
        info.srcUrl || 'icons/icon128.png'
      )
    );
    const outcomes = await Promise.allSettled(tasks);
    for (const outcome of outcomes)
      if (outcome.status === 'rejected')
        (deps.logger || console).warn(
          'Post-add update failed:',
          outcome.reason
        );
  }

  function createAlbumAddService(deps = {}) {
    const chrome = deps.chrome || globalThis.chrome;
    const logger = deps.logger || console;
    const { ACTIONS } = deps.constants || globalThis.ExtensionConstants;
    const identity = deps.albumIdentity || globalThis.AlbumIdentity;

    async function addAlbumToList(info, tab, listId, listName) {
      try {
        await deps.ensureStateLoaded();
        const validation = await deps.validateAndCleanToken();
        if (!validation.valid) {
          await deps.showErrorMenu('Not logged in');
          throw new Error('Please login to SuShe Online.');
        }
        const scope = deps.captureScope();
        scope.assertCurrent();
        const api =
          deps.albumApi ||
          globalThis.AlbumApiService.createAlbumApiService({
            ...deps,
            fetchWithTimeout: scope.request,
            getAuthHeaders: () => scope.headers,
            handleUnauthorized: scope.unauthorized,
          });
        const enrichment =
          deps.enrichment ||
          globalThis.AlbumAddEnrichment.createAlbumAddEnrichment({
            albumApi: api,
            handleUnauthorized: scope.unauthorized,
            logger,
          });
        const clicked = getInitialAlbumIdentity(identity, info);
        const speculative = clicked
          ? api
              .searchMusicBrainz(scope.apiBase, clicked)
              .then((releaseGroup) => ({ releaseGroup }))
              .catch((error) => ({ error }))
          : null;
        let album = await extractIdentity(chrome, ACTIONS, info, tab);
        scope.assertCurrent();
        if (album?.error) throw new Error(album.error);
        const selected =
          clicked ||
          identity.getContextAlbumIdentity({
            pageUrl: info.srcUrl ? album?.albumUrl : info.pageUrl,
          });
        validateExtractedAlbum(album, selected, identity);
        const retry = enrichment.startObservationRetry(album, () =>
          extractIdentity(chrome, ACTIONS, info, tab)
        );
        const release = await resolveRelease(
          api,
          scope.apiBase,
          album,
          clicked,
          speculative,
          logger
        );
        scope.assertCurrent();
        const appliedRetry = !!retry?.value;
        if (appliedRetry) album = { ...album, ...retry.value };
        const country = api
          .fetchArtistCountry(scope.apiBase, release)
          .catch((error) => {
            logger.warn('Artist country unavailable:', error.message);
            return '';
          });
        const payload = api.buildAlbumPayload(album, release, '');
        const response = await api.saveAlbum(scope.apiBase, listId, payload);
        scope.assertCurrent();
        if (!response.ok) {
          if (response.status === 401) {
            await scope.unauthorized();
            await deps.showErrorMenu('Not logged in');
            throw new Error(
              'Not authenticated. Please click the extension icon and login again.'
            );
          }
          throw await globalThis.SharedUtils.readApiError(
            response,
            'Failed to add album'
          );
        }
        const result = await response.json();
        if (!result.addedItems?.length && !result.duplicates?.length)
          throw new Error('Server did not confirm an album addition');
        await finishAddition({
          deps,
          enrichment,
          scope,
          album: payload,
          result,
          retry: appliedRetry ? null : retry,
          country,
          info,
          tab,
          listId,
          listName,
        });
      } catch (error) {
        logger.warn('Album addition failed:', error.message);
        await deps.showNotification(
          '❌ Error',
          error.message || 'Failed to add album to list'
        );
      }
    }
    return { addAlbumToList };
  }
  globalThis.AlbumAddService = { createAlbumAddService };
})();
