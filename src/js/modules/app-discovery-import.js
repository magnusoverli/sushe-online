/**
 * File import startup handlers.
 */

export function createAppDiscoveryImport(deps = {}) {
  const doc = deps.doc || (typeof document !== 'undefined' ? document : null);
  const showToast = deps.showToast || (() => {});

  const {
    getLists,
    selectList,
    importList,
    updateListNav,
    setPendingImport,
    setPendingImportFilename,
  } = deps;

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
    initializeFileImportHandlers,
  };
}
