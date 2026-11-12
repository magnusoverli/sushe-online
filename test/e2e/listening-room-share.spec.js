const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

// An isolated browser fixture exercises the real modal/focus/confirmation code
// and app stylesheet without needing production accounts or sharing real picks.
async function openFixture(
  page,
  { mobile = false, rejectFirstCopy = false } = {}
) {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  const root = path.resolve(__dirname, '../..');
  const assets = new Map([
    ['/styles.css', 'public/styles/output.css'],
    ...['listening-room-share', 'modal-factory', 'modal-a11y', 'modals'].map(
      (name) => [`/${name}.js`, `src/js/modules/${name}.js`]
    ),
  ]);
  await page.route('http://listening-room-ui.test/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (assets.has(pathname)) {
      return route.fulfill({
        contentType: pathname.endsWith('.css') ? 'text/css' : 'text/javascript',
        body: await fs.readFile(path.join(root, assets.get(pathname)), 'utf8'),
      });
    }
    await route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body class="bg-gray-900 text-white">
      <button id="open-share">Share to Doom Room</button>
      <div id="confirmationModal" class="hidden fixed inset-0 modal-overlay modal-layer flex items-center justify-center p-4">
        <div class="bg-gray-900 p-6 border border-gray-800 rounded-lg"><h3 id="confirmationTitle"></h3><p id="confirmationMessage"></p><p id="confirmationSubMessage"></p>
        <div id="confirmationCheckboxContainer"><input id="confirmationCheckbox" type="checkbox"><label id="confirmationCheckboxLabel"></label></div>
        <button id="confirmationCancelBtn" class="btn-modal-cancel">Cancel</button><button id="confirmationConfirmBtn" class="btn-danger">Stop sharing</button></div>
      </div>
      <script type="module">
        import { openListeningRoomShare } from '/listening-room-share.js';
        import { showConfirmation } from '/modals.js';
        window.copyCalls = 0;
        window.stopCalls = 0;
        document.getElementById('open-share').onclick = () => openListeningRoomShare({
          url: 'https://sushe.test/lr/abcdefghijklmnopqrstuv', expiresAt: '2026-11-15T13:32:00.000Z', songCount: 22, leftOut: { noPick: 2, disqualified: 1 }
        }, 'owned-list', {
          clipboard: { writeText: async () => { window.copyCalls++; if (${rejectFirstCopy} && window.copyCalls === 1) throw new Error('No gesture'); } },
          apiCall: async () => { window.stopCalls++; },
          showToast: (message) => { throw new Error(message); },
          showConfirmation
        });
      </script></body></html>`,
    });
  });
  await page.goto('http://listening-room-ui.test/');
  await page.locator('#open-share').click();
}

for (const mobile of [false, true]) {
  test(`Doom Room share window on ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }) => {
    await openFixture(page, { mobile });
    const dialog = page.getByRole('dialog', {
      name: 'Shared with Doom Room.',
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox')).toHaveAttribute('readonly', '');
    await expect(dialog.getByRole('textbox')).toHaveValue(
      'https://sushe.test/lr/abcdefghijklmnopqrstuv'
    );
    await expect(dialog).toContainText(
      '22 songs. Left out: 2 albums without a track pick, 1 disqualified album.'
    );
    await expect(
      dialog.getByRole('button', { name: 'Copied', exact: true })
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Copy link', exact: true })
    ).toBeVisible({ timeout: 4000 });
    await dialog
      .getByRole('button', { name: 'Stop sharing', exact: true })
      .click();
    const confirmation = page.getByRole('dialog', {
      name: 'Stop sharing',
      exact: true,
    });
    await expect(confirmation).toContainText(
      'Stop sharing this list? The link stops working right away.'
    );
    await confirmation.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Stop sharing', exact: true })
      .click();
    await confirmation
      .getByRole('button', { name: 'Stop sharing', exact: true })
      .click();
    await expect(dialog).toContainText(
      'Sharing stopped. The link no longer works.'
    );
    await expect(dialog.getByRole('button')).toHaveCount(1);
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#open-share')).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  });
}

test('automatic copy failure is silent and a direct tap retries', async ({
  page,
}) => {
  await openFixture(page, { rejectFirstCopy: true });
  await page.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Copied', exact: true })
  ).toBeVisible();
  expect(await page.evaluate(() => window.copyCalls)).toBe(2);
});

test('share controls remain reachable on short mobile screens', async ({
  page,
}) => {
  await openFixture(page, { mobile: true });
  await page.setViewportSize({ width: 375, height: 568 });
  const close = page.getByRole('button', { name: 'Close', exact: true });
  await expect(close).toBeInViewport();
  await close.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
