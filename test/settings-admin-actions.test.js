const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

function createElement(overrides = {}) {
  const listeners = {};
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    files: null,
    removeAttribute(name) {
      delete this[name];
    },
    remove() {
      this.removed = true;
    },
    listeners,
    classList: {
      removed: [],
      added: [],
      remove(...classes) {
        this.removed.push(...classes);
      },
      add(...classes) {
        this.added.push(...classes);
      },
    },
    addEventListener(event, handler) {
      listeners[event] = handler;
    },
    ...overrides,
  };
}

describe('settings admin actions', () => {
  let createSettingsAdminActions;

  beforeEach(async () => {
    const module =
      await import('../src/js/modules/settings-drawer/handlers/admin-actions.js');
    createSettingsAdminActions = module.createSettingsAdminActions;
  });

  it('handles account approval event action and reloads admin data', async () => {
    const confirmations = [];
    const apiCalls = [];
    const toasts = [];
    const loads = [];
    const categoryData = { admin: { stale: true } };

    const actions = createSettingsAdminActions({
      showConfirmation: async (...args) => {
        confirmations.push(args);
        return true;
      },
      apiCall: async (...args) => {
        apiCalls.push(args);
        return { success: true, message: 'Approved' };
      },
      showToast: (...args) => toasts.push(args),
      categoryData,
      loadCategoryData: async (categoryId) => loads.push(categoryId),
      createSettingsModalBase: () => ({
        modal: createElement(),
        open() {},
        close() {},
      }),
    });

    await actions.handleAdminEventAction('evt1', 'approve', {
      event_type: 'account_approval',
      data: { username: 'alice', email: 'alice@example.com' },
    });

    assert.match(confirmations[0][0], /Approve User Registration/);
    assert.match(confirmations[0][1], /alice/);
    assert.deepStrictEqual(apiCalls[0], [
      '/api/admin/events/evt1/action/approve',
      { method: 'POST' },
    ]);
    assert.deepStrictEqual(toasts[0], ['Approved', 'success']);
    assert.strictEqual(categoryData.admin, null);
    assert.deepStrictEqual(loads, ['admin']);
  });

  it('does not execute admin event action when confirmation is cancelled', async () => {
    const apiCalls = [];

    const actions = createSettingsAdminActions({
      showConfirmation: async () => false,
      apiCall: async (...args) => {
        apiCalls.push(args);
        return { success: true };
      },
      showToast: () => {},
      categoryData: {},
      loadCategoryData: async () => {},
      createSettingsModalBase: () => ({
        modal: createElement(),
        open() {},
        close() {},
      }),
    });

    await actions.handleAdminEventAction('evt1', 'reject', {
      event_type: 'account_approval',
      data: { username: 'alice' },
    });

    assert.strictEqual(apiCalls.length, 0);
  });

  it('opens restore modal and executes restore submit flow', async () => {
    const originalFormData = global.FormData;
    const formDataEntries = [];
    global.FormData = class MockFormData {
      append(key, value) {
        formDataEntries.push([key, value]);
      }
    };

    try {
      const cancelBtn = createElement();
      const confirmBtn = createElement();
      const form = createElement();
      const fileInput = createElement({ files: [{ name: 'backup.dump' }] });
      const errorEl = createElement();
      const progressEl = createElement();
      const progressText = createElement();
      const progressBar = createElement();
      const modal = createElement({
        querySelector(selector) {
          const map = {
            '#cancelRestoreBtn': cancelBtn,
            '#confirmRestoreBtn': confirmBtn,
            '#restoreDatabaseForm': form,
            '#backupFileInput': fileInput,
            '#restoreError': errorEl,
            '#restoreProgress': progressEl,
            '#restoreProgressText': progressText,
            '#restoreProgressBar': progressBar,
          };
          return map[selector] || null;
        },
      });

      const appended = [];
      const removed = [];
      const toasts = [];
      const apiCalls = [];

      const actions = createSettingsAdminActions({
        doc: {
          body: {
            appendChild(node) {
              appended.push(node);
            },
            contains(node) {
              return appended.includes(node) && !removed.includes(node);
            },
            removeChild(node) {
              removed.push(node);
            },
          },
        },
        setTimeoutFn: (fn) => {
          fn();
          return 0;
        },
        showConfirmation: async () => true,
        apiCall: async (...args) => {
          apiCalls.push(args);
          const { onUploadProgress } = args[1];
          onUploadProgress({ loaded: 1024 * 1024, total: 2 * 1024 * 1024 });
          assert.strictEqual(progressBar.value, 50);
          assert.match(progressText.textContent, /50% \(1.0 MiB \/ 2.0 MiB\)/);
          onUploadProgress({ complete: true });
          assert.strictEqual(progressBar.value, 100);
          assert.strictEqual(
            progressText.textContent,
            'Upload sent—waiting for server confirmation...'
          );
          await confirmBtn.listeners.click();
          assert.strictEqual(
            apiCalls.length,
            1,
            'Cannot submit twice during the upload'
          );
          return { message: 'Restore done' };
        },
        showToast: (...args) => toasts.push(args),
        categoryData: {},
        loadCategoryData: async () => {},
        createSettingsModalBase: () => ({
          modal,
          open() {
            modal.classList.remove('hidden');
          },
          close() {},
        }),
      });

      await actions.handleRestoreDatabase();
      assert.strictEqual(appended.length, 1);
      assert.strictEqual(appended[0], modal);
      assert.deepStrictEqual(modal.classList.removed, ['hidden']);

      await confirmBtn.listeners.click();

      assert.deepStrictEqual(formDataEntries, [['backup', fileInput.files[0]]]);
      assert.strictEqual(apiCalls[0][0], '/admin/restore');
      assert.ok(progressBar.classList.added.includes('hidden'));
      assert.strictEqual(toasts.length, 0);
    } finally {
      global.FormData = originalFormData;
    }
  });

  it('shows friendly restore error message for coded backend failures', async () => {
    const cancelBtn = createElement();
    const confirmBtn = createElement();
    const form = createElement();
    const fileInput = createElement({ files: [{ name: 'backup.dump' }] });
    const errorEl = createElement();
    const progressEl = createElement();
    const progressText = createElement();
    const modal = createElement({
      querySelector(selector) {
        const map = {
          '#cancelRestoreBtn': cancelBtn,
          '#confirmRestoreBtn': confirmBtn,
          '#restoreDatabaseForm': form,
          '#backupFileInput': fileInput,
          '#restoreError': errorEl,
          '#restoreProgress': progressEl,
          '#restoreProgressText': progressText,
        };
        return map[selector] || null;
      },
    });

    const actions = createSettingsAdminActions({
      doc: {
        body: {
          appendChild() {},
          contains() {
            return true;
          },
          removeChild() {},
        },
      },
      setTimeoutFn: (fn) => {
        fn();
        return 0;
      },
      showConfirmation: async () => true,
      apiCall: async () => {
        const error = new Error('Raw backend error');
        error.code = 'RESTORE_PRECHECK_FAILED';
        throw error;
      },
      showToast: () => {},
      categoryData: {},
      loadCategoryData: async () => {},
      createSettingsModalBase: () => ({
        modal,
        open() {
          modal.classList.remove('hidden');
        },
        close() {},
      }),
    });

    await actions.handleRestoreDatabase();
    await confirmBtn.listeners.click();

    assert.strictEqual(
      errorEl.textContent,
      'Backup validation failed before restore. Please verify the dump was created correctly.'
    );
    assert.strictEqual(confirmBtn.disabled, false);
    assert.strictEqual(confirmBtn.textContent, 'Restore Database');
  });

  it('polls restore status when restoreId is returned', async () => {
    const cancelBtn = createElement();
    const confirmBtn = createElement();
    const form = createElement();
    const fileInput = createElement({ files: [{ name: 'backup.dump' }] });
    const errorEl = createElement();
    const progressEl = createElement();
    const progressText = createElement();
    const modal = createElement({
      querySelector(selector) {
        const map = {
          '#cancelRestoreBtn': cancelBtn,
          '#confirmRestoreBtn': confirmBtn,
          '#restoreDatabaseForm': form,
          '#backupFileInput': fileInput,
          '#restoreError': errorEl,
          '#restoreProgress': progressEl,
          '#restoreProgressText': progressText,
        };
        return map[selector] || null;
      },
    });

    const apiCalls = [];
    const locationState = { href: '' };
    const phases = ['restarting', 'verifying-live', 'completed'];
    const actions = createSettingsAdminActions({
      doc: {
        body: {
          appendChild() {},
          contains() {
            return true;
          },
          removeChild() {},
        },
      },
      setTimeoutFn: (fn) => {
        fn();
        return 0;
      },
      showConfirmation: async () => true,
      apiCall: async (url) => {
        apiCalls.push(url);

        if (url === '/admin/restore') {
          return {
            restoreId: 'restore_1',
            message:
              'Database restored successfully. Server will restart in 3 seconds...',
          };
        }
        assert.strictEqual(
          locationState.href,
          '',
          'Do not report completion during restart/verification'
        );
        return {
          restoreId: 'restore_1',
          status: phases.shift(),
        };
      },
      win: {
        location: locationState,
      },
      showToast: () => {},
      categoryData: {},
      loadCategoryData: async () => {},
      createSettingsModalBase: () => ({
        modal,
        open() {
          modal.classList.remove('hidden');
        },
        close() {},
      }),
    });

    await actions.handleRestoreDatabase();
    await confirmBtn.listeners.click();

    assert.ok(apiCalls.includes('/admin/restore'));
    assert.ok(apiCalls.includes('/admin/restore/restore_1/status'));
    assert.strictEqual(phases.length, 0);
    assert.strictEqual(progressText.textContent, 'Logging out...');
    assert.strictEqual(locationState.href, '/logout');
  });

  for (const mode of ['known size', 'unknown size', 'compressed']) {
    it(`downloads backup with progress feedback: ${mode}`, async () => {
      const closeBtn = createElement();
      const progressText = createElement();
      const progressBar = createElement();
      const errorEl = createElement();
      const spinner = createElement();
      const modal = createElement({
        querySelector(selector) {
          const map = {
            '#closeDownloadBackupModalBtn': closeBtn,
            '#downloadBackupProgressText': progressText,
            '#downloadBackupProgressBar': progressBar,
            '#downloadBackupError': errorEl,
            '#downloadBackupSpinner': spinner,
          };
          return map[selector] || null;
        },
      });

      const createdLinks = [];
      const objectUrls = [];
      const revokedUrls = [];
      const fetchCalls = [];
      const snapshots = [];
      let released = false;
      let reads = 0;
      let closeCalls = 0;

      const doc = {
        createElement() {
          const link = {
            href: '',
            download: '',
            style: {},
            clicked: false,
            click() {
              this.clicked = true;
            },
          };
          createdLinks.push(link);
          return link;
        },
        body: {
          appended: [],
          removed: [],
          appendChild(node) {
            this.appended.push(node);
          },
          removeChild(node) {
            this.removed.push(node);
          },
          contains(node) {
            return this.appended.includes(node) && !this.removed.includes(node);
          },
        },
      };

      const actions = createSettingsAdminActions({
        doc,
        setTimeoutFn: (fn) => {
          fn();
          return 0;
        },
        fetchImpl: async (url) => {
          fetchCalls.push(url);
          assert.strictEqual(progressText.textContent, 'Generating backup...');
          assert.strictEqual(progressBar.value, undefined);
          return {
            ok: true,
            status: 200,
            headers: {
              get(name) {
                if (name === 'content-disposition') {
                  return 'attachment; filename="backup-2026.dump"';
                }
                if (name === 'content-length' && mode !== 'unknown size')
                  return String(2 * 1024 * 1024);
                if (name === 'content-encoding' && mode === 'compressed')
                  return 'gzip';
                return null;
              },
            },
            body: {
              getReader: () => ({
                async read() {
                  if (reads > 0)
                    snapshots.push({
                      text: progressText.textContent,
                      value: progressBar.value,
                    });
                  return reads++ < 2
                    ? { value: new Uint8Array(1024 * 1024), done: false }
                    : { done: true };
                },
                releaseLock() {
                  released = true;
                },
              }),
            },
          };
        },
        win: {
          location: { href: '', reload() {} },
          URL: {
            createObjectURL(blob) {
              objectUrls.push(blob);
              return 'blob:test';
            },
            revokeObjectURL(url) {
              revokedUrls.push(url);
            },
          },
        },
        showConfirmation: async () => true,
        apiCall: async () => ({}),
        showToast: () => {},
        categoryData: {},
        loadCategoryData: async () => {},
        createSettingsModalBase: () => ({
          modal,
          open() {
            modal.classList.remove('hidden');
          },
          close() {
            closeCalls++;
          },
        }),
      });

      await actions.handleDownloadBackup({
        preventDefault() {},
      });

      assert.ok(fetchCalls.includes('/admin/backup'));
      assert.strictEqual(createdLinks.length, 1);
      assert.strictEqual(createdLinks[0].download, 'backup-2026.dump');
      assert.strictEqual(createdLinks[0].clicked, true);
      assert.strictEqual(objectUrls.length, 1);
      assert.deepStrictEqual(revokedUrls, ['blob:test']);
      assert.strictEqual(
        progressText.textContent,
        'Backup transferred to your browser. Check your downloads or choose a save location if prompted.'
      );
      assert.strictEqual(spinner.removed, true);
      assert.ok(!spinner.classList.added.includes('fa-check-circle'));
      assert.strictEqual(
        closeCalls,
        0,
        'Browser handoff does not automatically dismiss the dialog'
      );
      assert.strictEqual(closeBtn.textContent, 'Done');
      assert.strictEqual(closeBtn.disabled, false);
      closeBtn.listeners.click();
      assert.strictEqual(closeCalls, 1);
      assert.strictEqual(progressBar.value, 100);
      assert.strictEqual(released, true);
      assert.strictEqual(objectUrls[0].size, 2 * 1024 * 1024);
      if (mode === 'known size') {
        assert.deepStrictEqual(snapshots[0], {
          text: 'Downloading backup... 50% (1.0 MiB / 2.0 MiB)',
          value: 50,
        });
      } else {
        assert.deepStrictEqual(snapshots[0], {
          text: 'Downloading backup... 1.0 MiB',
          value: undefined,
        });
      }
    });
  }

  it('falls back to direct download when backup fetch network fails', async () => {
    const closeBtn = createElement();
    const progressText = createElement();
    const errorEl = createElement();
    const modal = createElement({
      querySelector(selector) {
        const map = {
          '#closeDownloadBackupModalBtn': closeBtn,
          '#downloadBackupProgressText': progressText,
          '#downloadBackupError': errorEl,
        };
        return map[selector] || null;
      },
    });

    let closeCalls = 0;

    const doc = {
      body: {
        appended: [],
        removed: [],
        appendChild(node) {
          this.appended.push(node);
        },
        removeChild(node) {
          this.removed.push(node);
        },
        contains(node) {
          return this.appended.includes(node) && !this.removed.includes(node);
        },
      },
    };

    const win = {
      location: { href: '', reload() {} },
      URL: {
        createObjectURL() {
          return 'blob:test';
        },
        revokeObjectURL() {},
      },
    };

    const actions = createSettingsAdminActions({
      doc,
      setTimeoutFn: (fn) => {
        fn();
        return 0;
      },
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
      win,
      showConfirmation: async () => true,
      apiCall: async () => ({}),
      showToast: () => {},
      categoryData: {},
      loadCategoryData: async () => {},
      createSettingsModalBase: () => ({
        modal,
        open() {
          modal.classList.remove('hidden');
        },
        close() {
          closeCalls++;
        },
      }),
    });

    await actions.handleDownloadBackup({
      preventDefault() {},
    });

    assert.strictEqual(win.location.href, '/admin/backup');
    assert.strictEqual(closeCalls, 1);
    assert.strictEqual(errorEl.textContent, '');
    assert.ok(
      progressText.textContent.includes('Switching to direct download')
    );
  });
});
