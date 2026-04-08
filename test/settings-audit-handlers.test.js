const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

function createElement(overrides = {}) {
  const listeners = {};
  return {
    value: '',
    disabled: false,
    textContent: '',
    innerHTML: '',
    classList: {
      remove() {},
      add() {},
    },
    listeners,
    addEventListener(event, handler) {
      listeners[event] = handler;
    },
    ...overrides,
  };
}

function createDocument(ids = {}) {
  return {
    getElementById(id) {
      return ids[id] || null;
    },
  };
}

describe('settings audit handlers', () => {
  let createSettingsAuditHandlers;

  beforeEach(async () => {
    const module =
      await import('../src/js/modules/settings-drawer/handlers/audit-handlers.js');
    createSettingsAuditHandlers = module.createSettingsAuditHandlers;
  });

  it('handles duplicate scan with no matches', async () => {
    const scanBtn = createElement();
    const statusDiv = createElement();
    const threshold = createElement({ value: '0.30' });
    const toasts = [];
    const apiCalls = [];

    const { handleScanDuplicates } = createSettingsAuditHandlers({
      doc: createDocument({
        scanDuplicatesBtn: scanBtn,
        duplicateScanStatus: statusDiv,
        duplicateThreshold: threshold,
      }),
      apiCall: async (url) => {
        apiCalls.push(url);
        return {
          pairs: [],
          totalAlbums: 10,
          excludedPairs: 2,
        };
      },
      showToast: (...args) => toasts.push(args),
      openDuplicateReviewModal: async () => ({ resolved: 0, remaining: 0 }),
    });

    await handleScanDuplicates();

    assert.deepStrictEqual(apiCalls, [
      '/admin/api/scan-duplicates?threshold=0.3',
    ]);
    assert.match(statusDiv.innerHTML, /No potential duplicates found/);
    assert.deepStrictEqual(toasts[0], [
      'No potential duplicates found',
      'success',
    ]);
    assert.strictEqual(scanBtn.disabled, false);
    assert.strictEqual(scanBtn.textContent, 'Scan & Review');
  });

  it('opens duplicate review modal when matches exist', async () => {
    const scanBtn = createElement();
    const statusDiv = createElement();
    const threshold = createElement({ value: '0.15' });
    const modalCalls = [];

    const { handleScanDuplicates } = createSettingsAuditHandlers({
      doc: createDocument({
        scanDuplicatesBtn: scanBtn,
        duplicateScanStatus: statusDiv,
        duplicateThreshold: threshold,
      }),
      apiCall: async () => ({
        pairs: [{ id: 'p1' }],
        potentialDuplicates: 1,
        totalAlbums: 10,
        excludedPairs: 0,
      }),
      showToast: () => {},
      openDuplicateReviewModal: async (pairs) => {
        modalCalls.push(pairs);
        return { resolved: 1, remaining: 0 };
      },
    });

    await handleScanDuplicates();

    assert.deepStrictEqual(modalCalls, [[{ id: 'p1' }]]);
    assert.match(
      statusDiv.innerHTML,
      /Last scan: 1 found, 1 resolved, 0 remaining/
    );
  });

  it('runs manual album audit and opens modal when review data exists', async () => {
    const auditBtn = createElement();
    const statusDiv = createElement();
    const threshold = createElement({ value: '0.03' });
    const modalCalls = [];
    const toasts = [];
    const payload = {
      totalManual: 4,
      totalWithMatches: 2,
      integrityIssues: [{ id: 'i1' }],
    };

    const { handleAuditManualAlbums } = createSettingsAuditHandlers({
      doc: createDocument({
        auditManualAlbumsBtn: auditBtn,
        manualAlbumAuditStatus: statusDiv,
        manualAlbumThreshold: threshold,
      }),
      apiCall: async () => payload,
      showToast: (...args) => toasts.push(args),
      openManualAlbumAudit: async (selectedThreshold, data) => {
        modalCalls.push([selectedThreshold, data]);
      },
    });

    await handleAuditManualAlbums();

    assert.deepStrictEqual(modalCalls, [[0.03, payload]]);
    assert.match(statusDiv.innerHTML, /Last audit: 4 manual albums checked/);
    assert.strictEqual(toasts.length, 0);
    assert.strictEqual(auditBtn.disabled, false);
    assert.strictEqual(auditBtn.textContent, 'Audit Manual Albums');
  });
});
