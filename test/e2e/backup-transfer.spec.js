// Exercise actual browser network progress against synthetic endpoints: no
// application database or real backup is used by these transfer-only tests.
const { test, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const MIB = 1024 * 1024;
let server, origin, acceptUpload, startDownload, finishDownload, statusRequests;

test.beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/admin/restore' && req.method === 'POST') {
      if (req.headers['x-csrf-token'] !== 'synthetic-token') {
        res.writeHead(403).end();
        return;
      }
      req.resume();
      req.on('end', () => {
        acceptUpload = () =>
          res
            .writeHead(202, { 'Content-Type': 'application/json' })
            .end(JSON.stringify({ restoreId: 'synthetic' }));
      });
      return;
    }
    if (url.pathname === '/admin/restore/synthetic/status') {
      statusRequests++;
      res
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ status: 'verifying-live' }));
      return;
    }
    if (url.pathname === '/admin/backup') {
      startDownload = () => {
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="synthetic.dump"',
          'Content-Length': 4 * MIB,
        });
        res.write(Buffer.alloc(MIB, 1));
        finishDownload = () => res.end(Buffer.alloc(3 * MIB, 1));
      };
      return;
    }
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<!doctype html>
        <html><head><link rel="stylesheet" href="/public/styles/output.css"><link rel="stylesheet" href="/public/vendor/fontawesome/css/all.min.css"></head>
        <body style="background:#111;color:#ddd">
          <button id="upload">Restore database</button><button id="download">Download backup</button>
          <script type="module">
            import { createSettingsAdminActions } from '/src/js/modules/settings-drawer/handlers/admin-actions.js';
            import { createSettingsModal } from '/src/js/modules/ui-factories.js';
            import { createAppApiClient } from '/src/js/modules/app-api-client.js';
            window.csrfToken = 'synthetic-token';
            const { apiCall } = createAppApiClient({ getRealtimeSyncModuleInstance: () => null });
            const actions = createSettingsAdminActions({ apiCall, createSettingsModalBase: createSettingsModal });
            document.querySelector('#upload').onclick = () => actions.handleRestoreDatabase();
            document.querySelector('#download').onclick = (event) => actions.handleDownloadBackup(event);
          </script>
        </body></html>`);
      return;
    }
    const root = path.resolve(__dirname, '../..');
    const file = path.resolve(root, `.${url.pathname}`);
    if (!(
      file.startsWith(path.join(root, 'src/js/')) ||
      file.startsWith(path.join(root, 'public/vendor/fontawesome/')) ||
      file === path.join(root, 'public/styles/output.css')
    )) {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = await fs.readFile(file);
      res
        .writeHead(200, {
          'Content-Type': file.endsWith('.css')
            ? 'text/css'
            : file.endsWith('.woff2')
              ? 'font/woff2'
              : 'text/javascript',
        })
        .end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

test('upload shows bytes, waits for server acceptance, then tracks recovery', async ({
  page,
}, testInfo) => {
  statusRequests = 0;
  acceptUpload = null;
  await page.goto(origin);
  await page.locator('#upload').click();
  await page.locator('#backupFileInput').setInputFiles({
    name: 'synthetic.dump',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(4 * MIB),
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 20,
    downloadThroughput: -1,
    uploadThroughput: MIB,
  });
  await page.locator('#confirmRestoreBtn').click();
  const progress = page.getByRole('progressbar', { name: 'Backup upload' });
  await expect(progress).toBeVisible();
  await expect
    .poll(async () => Number(await progress.getAttribute('value')))
    .toBeGreaterThan(0);
  expect(Number(await progress.getAttribute('value'))).toBeLessThan(100);
  await expect(page.locator('#restoreProgressText')).toContainText('MiB /');
  await page.screenshot({ path: testInfo.outputPath('upload-progress.png') });
  await expect(page.locator('#restoreProgressText')).toHaveText(
    'Upload sent—waiting for server confirmation...'
  );
  expect(statusRequests).toBe(0);
  await expect.poll(() => typeof acceptUpload).toBe('function');
  acceptUpload();
  await expect(page.locator('#restoreProgressText')).toHaveText(
    'Checking the restarted app...'
  );
  await expect(progress).toBeHidden();
  expect(statusRequests).toBeGreaterThan(0);
});

for (const reducedMotion of ['no-preference', 'reduce']) {
  test(`download explains browser handoff and waits for Done (${reducedMotion})`, async ({
    page,
  }, testInfo) => {
    startDownload = null;
    await page.emulateMedia({ reducedMotion });
    await page.goto(origin);
    const downloaded = page.waitForEvent('download');
    await page.locator('#download').click();
    const progress = page.getByRole('progressbar', { name: 'Backup download' });
    await expect(progress).toBeVisible();
    await expect(page.locator('#downloadBackupProgressText')).toHaveText(
      'Generating backup...'
    );
    expect(await progress.getAttribute('value')).toBeNull();
    await expect(page.locator('#downloadBackupSpinner')).toHaveCSS(
      'animation-name',
      reducedMotion === 'reduce' ? 'none' : 'fa-spin'
    );
    await expect.poll(() => typeof startDownload).toBe('function');
    startDownload();
    await expect
      .poll(async () => Number(await progress.getAttribute('value')))
      .toBeGreaterThan(0);
    expect(Number(await progress.getAttribute('value'))).toBeLessThan(100);
    await expect(page.locator('#downloadBackupProgressText')).toContainText(
      'MiB / 4.0 MiB'
    );
    await page.screenshot({
      path: testInfo.outputPath('download-progress.png'),
    });
    await page.clock.install();
    finishDownload();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe('synthetic.dump');
    expect((await fs.stat(await download.path())).size).toBe(4 * MIB);
    await expect(page.locator('#downloadBackupProgressText')).toHaveText(
      'Backup transferred to your browser. Check your downloads or choose a save location if prompted.'
    );
    await expect(page.locator('#downloadBackupSpinner')).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath('browser-handoff.png') });
    const done = page.getByRole('button', { name: 'Done', exact: true });
    await expect(done).toBeEnabled();
    // Advance past the former auto-dismiss delay without waiting in real time.
    await page.clock.runFor(2000);
    await expect(done).toBeVisible();
    await done.click();
    await expect(page.locator('#downloadBackupModal')).toBeHidden();
  });
}
