// Optional post-add enrichment for the extension album workflow.

(function () {
  function createAlbumAddEnrichment(deps = {}) {
    const { albumApi, handleUnauthorized, logger = console } = deps;

    function hasCompleteObservation(albumData) {
      return albumData?.sourceObservation?.taxonomy?.complete === true;
    }

    function startObservationRetry(albumData, retryExtraction) {
      if (
        hasCompleteObservation(albumData) ||
        (!albumData.sourceObservation && !albumData.albumUrl)
      ) {
        return null;
      }

      const state = { value: null };
      state.promise = retryExtraction()
        .then((retryData) => {
          if (!hasCompleteObservation(retryData)) return null;
          state.value = retryData;
          return retryData;
        })
        .catch((error) => {
          logger.warn('RYM observation retry failed:', error);
          return null;
        });
      return state;
    }

    async function persistObservation({ apiBase, albumId, retryPromise }) {
      const retriedAlbumData = await retryPromise;
      if (!retriedAlbumData) return;

      const response = await albumApi.updateSourceObservation(
        apiBase,
        albumId,
        retriedAlbumData.sourceObservation
      );
      if (response.status === 401) {
        await handleUnauthorized();
      } else if (!response.ok) {
        logger.warn('Could not save retried RYM observation:', response.status);
      }
    }

    async function enrichCountry(apiBase, countryPromise, albumId) {
      if (!albumId) return;
      const country = await countryPromise;
      if (!country) return;

      const response = await albumApi.updateAlbumMetadata(apiBase, [
        { albumId, country },
      ]);
      if (response.status === 401) {
        await handleUnauthorized();
      } else if (!response.ok) {
        logger.warn(
          'Could not update album country after add:',
          response.status
        );
      }
    }

    return { startObservationRetry, persistObservation, enrichCountry };
  }

  globalThis.AlbumAddEnrichment = { createAlbumAddEnrichment };
})();
