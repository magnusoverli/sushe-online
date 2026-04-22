/**
 * Dynamic service/integration loaders used by app.js.
 */
export function createAppServiceIntegrations(deps = {}) {
  const {
    getMusicServicesModule,
    setMusicServicesModule,
    getImportExportModule,
    setImportExportModule,
    showToast,
    getListData,
    getListMetadata,
    importMusicServices = () => import('./music-services.js'),
    importImportExport = () => import('./import-export.js'),
  } = deps;

  async function loadMusicServicesModule() {
    let mod = getMusicServicesModule();
    if (!mod) {
      mod = await importMusicServices();
      setMusicServicesModule(mod);
    }
    return mod;
  }

  async function loadImportExportModule() {
    let mod = getImportExportModule();
    if (!mod) {
      showToast('Loading export module...', 'info', 1000);
      mod = await importImportExport();
      setImportExportModule(mod);
    }
    return mod;
  }

  async function showServicePicker(hasSpotify, hasTidal) {
    const mod = await loadMusicServicesModule();
    return mod.showServicePicker(hasSpotify, hasTidal);
  }

  async function downloadListAsJSON(listId) {
    const mod = await loadImportExportModule();
    return mod.downloadListAsJSON(listId);
  }

  async function downloadListAsPDF(listId) {
    const mod = await loadImportExportModule();
    return mod.downloadListAsPDF(listId);
  }

  async function downloadListAsCSV(listId) {
    const mod = await loadImportExportModule();
    return mod.downloadListAsCSV(listId);
  }

  async function updatePlaylist(listId, listData = null) {
    if (!getMusicServicesModule()) {
      showToast('Loading playlist integration...', 'info', 1000);
    }
    const mod = await loadMusicServicesModule();
    const data = listData !== null ? listData : getListData(listId) || [];
    const meta = getListMetadata(listId);
    const listName = meta?.name || listId;
    return mod.updatePlaylist(listId, listName, data);
  }

  return {
    showServicePicker,
    downloadListAsJSON,
    downloadListAsPDF,
    downloadListAsCSV,
    updatePlaylist,
  };
}
