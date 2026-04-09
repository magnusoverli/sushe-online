/**
 * Discovery add flow and file import startup handlers.
 */

export function createAppDiscoveryImport(deps = {}) {
  const doc = deps.doc || (typeof document !== 'undefined' ? document : null);
  const win = deps.win || (typeof window !== 'undefined' ? window : null);
  const fetchFn = deps.fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
  const logger = deps.logger || console;
  const showToast = deps.showToast || (() => {});

  const {
    getListData,
    apiCall,
    saveList,
    getLists,
    getCurrentListId,
    selectList,
    importList,
    updateListNav,
    setPendingImport,
    setPendingImportFilename,
  } = deps;

  function registerDiscoveryAddAlbumHandler() {
    if (!win || !fetchFn) return;

    win.addEventListener('discovery-add-album', async (event) => {
      const { artist, album, listName } = event.detail || {};
      if (!artist || !album || !listName) {
        showToast('Missing album information', 'error');
        return;
      }

      try {
        showToast(`Searching for "${album}" by ${artist}...`, 'info');

        const searchQuery = encodeURIComponent(`${artist} ${album}`);
        const mbResponse = await fetchFn(
          `/api/proxy/musicbrainz?endpoint=release-group/?query=${searchQuery}&type=album&limit=5&fmt=json`,
          { credentials: 'include' }
        );

        if (!mbResponse.ok) {
          throw new Error('MusicBrainz search failed');
        }

        const mbData = await mbResponse.json();
        const releaseGroups = mbData['release-groups'] || [];

        if (releaseGroups.length === 0) {
          showToast(
            `Could not find "${album}" on MusicBrainz. Try adding manually.`,
            'error'
          );
          return;
        }

        const normalizeStr = (value) =>
          value?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';
        const targetArtist = normalizeStr(artist);
        const targetAlbum = normalizeStr(album);

        let bestMatch = releaseGroups[0];
        for (const releaseGroup of releaseGroups) {
          const releaseArtist = normalizeStr(
            releaseGroup['artist-credit']?.[0]?.name ||
              releaseGroup['artist-credit']?.[0]?.artist?.name
          );
          const releaseAlbum = normalizeStr(releaseGroup.title);
          if (releaseArtist === targetArtist && releaseAlbum === targetAlbum) {
            bestMatch = releaseGroup;
            break;
          }
        }

        const artistName =
          bestMatch['artist-credit']?.[0]?.name ||
          bestMatch['artist-credit']?.[0]?.artist?.name ||
          artist;
        const albumTitle = bestMatch.title || album;
        const releaseDate = bestMatch['first-release-date'] || '';

        const newAlbum = {
          artist: artistName,
          album: albumTitle,
          album_id: bestMatch.id,
          release_date: releaseDate,
          country: '',
          genre_1: '',
          genre_2: '',
        };

        let targetListData = getListData(listName);
        if (!targetListData) {
          targetListData = await apiCall(
            `/api/lists/${encodeURIComponent(listName)}`
          );
        }

        if (!targetListData) {
          targetListData = [];
        }

        const isDuplicate = targetListData.some(
          (entry) =>
            entry.artist?.toLowerCase() === artistName.toLowerCase() &&
            entry.album?.toLowerCase() === albumTitle.toLowerCase()
        );

        if (isDuplicate) {
          showToast(`"${albumTitle}" already exists in "${listName}"`, 'error');
          return;
        }

        targetListData.push(newAlbum);
        await saveList(listName, targetListData);

        const listMetadata = getLists()[listName];
        if (listMetadata) {
          listMetadata._data = null;
        }

        if (getCurrentListId() === listName) {
          selectList(listName);
        }

        import('./discovery.js').then(({ refreshUserLists }) => {
          refreshUserLists();
        });

        showToast(`Added "${albumTitle}" to "${listName}"`);
      } catch (error) {
        logger.error('Error adding album from discovery:', error);
        showToast('Failed to add album. Try adding manually.', 'error');
      }
    });
  }

  function initializeFileImportHandlers() {
    if (!doc) return;

    const importBtn = doc.getElementById('importBtn');
    const fileInput = doc.getElementById('fileInput');
    if (!importBtn || !fileInput) {
      return;
    }

    importBtn.onclick = () => {
      fileInput.click();
    };

    fileInput.onchange = async (event) => {
      const file = event.target.files[0];
      if (!file) {
        event.target.value = '';
        return;
      }

      const reader = new FileReader();
      reader.onload = async (loadEvent) => {
        try {
          const parsed = JSON.parse(loadEvent.target.result);

          let albums;
          let metadata;
          let fileName;

          if (Array.isArray(parsed)) {
            albums = parsed;
            metadata = null;
            fileName = file.name.replace(/\.json$/, '');
          } else if (parsed.albums && Array.isArray(parsed.albums)) {
            albums = parsed.albums;
            metadata = parsed._metadata || null;
            fileName = metadata?.list_name || file.name.replace(/\.json$/, '');
          } else {
            throw new Error(
              'Invalid JSON format: expected array or object with albums array'
            );
          }

          if (getLists()[fileName]) {
            setPendingImport({ albums, metadata });
            setPendingImportFilename(fileName);

            const listNameEl = doc.getElementById('conflictListName');
            if (listNameEl) {
              listNameEl.textContent = fileName;
            }

            const conflictModal = doc.getElementById('importConflictModal');
            conflictModal?.classList.remove('hidden');
            return;
          }

          await importList(fileName, albums, metadata);
          updateListNav();
          selectList(fileName);
          showToast(`Successfully imported ${albums.length} albums`);
        } catch (error) {
          showToast('Error importing file: ' + error.message, 'error');
        }
      };

      reader.onerror = () => {
        showToast('Error reading file', 'error');
      };

      reader.readAsText(file);
      event.target.value = '';
    };
  }

  return {
    registerDiscoveryAddAlbumHandler,
    initializeFileImportHandlers,
  };
}
