const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

describe('app-service-integrations module', () => {
  let createAppServiceIntegrations;

  beforeEach(async () => {
    const module =
      await import('../src/js/modules/app-service-integrations.js');
    createAppServiceIntegrations = module.createAppServiceIntegrations;
  });

  it('loads and caches import-export module for downloads', async () => {
    let importExportModule = null;
    const showToast = mock.fn();
    const importImportExport = mock.fn(async () => ({
      downloadListAsJSON: async (id) => `json:${id}`,
      downloadListAsPDF: async (id) => `pdf:${id}`,
      downloadListAsCSV: async (id) => `csv:${id}`,
    }));

    const integrations = createAppServiceIntegrations({
      getMusicServicesModule: () => null,
      setMusicServicesModule: () => {},
      getImportExportModule: () => importExportModule,
      setImportExportModule: (module) => {
        importExportModule = module;
      },
      showToast,
      getListData: () => [],
      getListMetadata: () => null,
      importImportExport,
    });

    assert.strictEqual(
      await integrations.downloadListAsJSON('abc'),
      'json:abc'
    );
    assert.strictEqual(await integrations.downloadListAsPDF('abc'), 'pdf:abc');
    assert.strictEqual(await integrations.downloadListAsCSV('abc'), 'csv:abc');

    assert.strictEqual(importImportExport.mock.calls.length, 1);
    assert.strictEqual(showToast.mock.calls.length, 1);
  });

  it('loads music services for picker and playlist updates', async () => {
    let musicServicesModule = null;
    const showToast = mock.fn();
    const importMusicServices = mock.fn(async () => ({
      showServicePicker: async (spotify, tidal) =>
        spotify && tidal ? 'both' : 'single',
      updatePlaylist: async (name, data) => ({ name, count: data.length }),
    }));

    const integrations = createAppServiceIntegrations({
      getMusicServicesModule: () => musicServicesModule,
      setMusicServicesModule: (module) => {
        musicServicesModule = module;
      },
      getImportExportModule: () => null,
      setImportExportModule: () => {},
      showToast,
      getListData: () => [{ album: 'A' }],
      getListMetadata: () => ({ name: 'Road Trip' }),
      importMusicServices,
    });

    const playlistResult = await integrations.updatePlaylist('trip');
    assert.deepStrictEqual(playlistResult, { name: 'Road Trip', count: 1 });

    assert.strictEqual(
      await integrations.showServicePicker(true, true),
      'both'
    );

    const explicitResult = await integrations.updatePlaylist('trip', []);
    assert.deepStrictEqual(explicitResult, { name: 'Road Trip', count: 0 });

    assert.strictEqual(importMusicServices.mock.calls.length, 1);
    assert.strictEqual(showToast.mock.calls.length, 1);
    assert.deepStrictEqual(showToast.mock.calls[0].arguments, [
      'Loading playlist integration...',
      'info',
      1000,
    ]);
  });
});
