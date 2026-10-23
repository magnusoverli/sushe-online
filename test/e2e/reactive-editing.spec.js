const { test, expect } = require('@playwright/test');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('node:crypto');
const { sessionApi } = require('./session-api');

function captureListEvents(page) {
  const events = [];
  page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      const text = String(payload);
      if (!text.startsWith('42[')) return;
      const [event, data] = JSON.parse(text.slice(2));
      if (event === 'list:updated' || event === 'list:reordered') {
        events.push({ event, ...data });
      }
    });
  });
  return events;
}

test.describe('Live album editing', () => {
  test.skip(!process.env.DATABASE_URL, 'Requires the local test database');
  let pool;
  const id = randomUUID();
  const email = `reactive-${id}@example.com`;
  const password = 'ReactiveTest123!';

  test.beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(
      `INSERT INTO users (_id, email, username, hash, role, approval_status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'user', 'approved', NOW(), NOW())`,
      [id, email, `reactive-${id.slice(0, 8)}`, await bcrypt.hash(password, 12)]
    );
  });
  test.afterAll(async () => {
    if (!pool) return;
    await pool.query('DELETE FROM users WHERE _id = $1', [id]);
    await pool.end();
  });

  test('reconciles picks, reordering, remote clearing, editor drafts and breakpoint changes', async ({
    page,
  }, testInfo) => {
    const errors = [];
    const originEvents = captureListEvents(page);
    page.on('pageerror', (error) => errors.push(error.stack || error.message));
    await page.goto('/login');
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/$/);
    const api = sessionApi(page);
    const response = await api.post('/api/lists', {
      data: {
        name: `Reactive ${id}`,
        data: [
          {
            artist: `Test ${id}`,
            album: 'Reactive album',
            tracks: [
              { name: '1979', position: 1, length: 120000 },
              { name: '2 + 2 = 5', position: 2, length: 180000 },
            ],
          },
          { artist: `Test ${id}`, album: 'Another album' },
        ],
      },
    });
    expect(response.status()).toBe(201);
    const listId = (await response.json())._id;
    let otherPage;
    try {
      await page.reload();
      await page
        .getByRole('button', { name: new RegExp(`Reactive ${id}`) })
        .first()
        .click();
      const row = page.locator('.album-rows-container .album-row').first();
      await expect(row).toBeVisible();
      otherPage = await page.context().newPage();
      const remoteEvents = captureListEvents(otherPage);
      await otherPage.goto('/');
      await otherPage
        .getByRole('button', { name: new RegExp(`Reactive ${id}`) })
        .first()
        .click();
      const otherRow = otherPage
        .locator('.album-rows-container .album-row')
        .first();
      await expect(otherRow).toBeVisible();
      const pickRequest = page.waitForRequest(
        (request) =>
          request.url().includes('/api/track-picks/') &&
          request.method() === 'PUT'
      );
      await row.locator('.track-cell').click();
      await page
        .locator('#quickTrackMenu .track-option')
        .filter({ hasText: '1979' })
        .click();
      await expect(
        row.locator('[data-field="secondary-track-text"]')
      ).toContainText('1979');
      const originSocketId = (await pickRequest).headers()['x-socket-id'];
      expect(originSocketId).toBeTruthy();
      await expect(
        otherRow.locator('[data-field="secondary-track-text"]')
      ).toContainText('1979');
      await expect(otherPage.locator('#toast')).toHaveText(
        'List updated from another device'
      );
      await expect(page.locator('#toast')).not.toHaveText(
        'List updated from another device'
      );
      await page
        .locator('#quickTrackMenu .track-option')
        .filter({ hasText: '1979' })
        .click();
      await expect(
        row.locator('[data-field="primary-track-text"]')
      ).toContainText('1979');
      await page
        .locator('#quickTrackMenu')
        .getByRole('button', { name: 'Clear all picks' })
        .click();
      await expect(row.locator('[data-field="primary-track-text"]')).toHaveText(
        'Select Track'
      );
      await expect(
        row.locator('[data-field="secondary-track-text"]')
      ).toHaveCount(0);
      await expect(
        otherRow.locator('[data-field="primary-track-text"]')
      ).toHaveText('Select Track');
      await expect(page.locator('#toast')).not.toHaveText(
        'List updated from another device'
      );
      await page.locator('.album-name').first().click();
      for (const firstAlbum of ['Another album', 'Reactive album']) {
        const previousCount = remoteEvents.length;
        const reorderResponse = page.waitForResponse(
          (response) =>
            response.url().endsWith(`/api/lists/${listId}/reorder`) &&
            response.request().method() === 'POST'
        );
        const rows = page.locator('.album-rows-container .album-row');
        const target = await rows.last().boundingBox();
        await rows.first().dragTo(rows.last(), {
          sourcePosition: { x: 10, y: 10 },
          targetPosition: { x: 10, y: target.height - 5 },
        });
        const reordered = await reorderResponse;
        expect(reordered.ok()).toBe(true);
        expect(reordered.request().headers()['x-socket-id']).toBe(
          originSocketId
        );
        await expect(row.locator('.album-name')).toHaveText(firstAlbum);
        await expect(otherRow.locator('.album-name')).toHaveText(firstAlbum);
        expect(
          remoteEvents.slice(previousCount).map(({ event }) => event)
        ).toEqual(['list:updated']);
        expect(originEvents).toEqual([]);
        await expect(page.locator('#toast')).not.toHaveText(
          'List updated from another device'
        );
      }
      await otherPage.close();
      otherPage = null;
      await page.locator('.album-name').first().click();
      await row.locator('.album-name').dblclick();
      await page.locator('#editComments').fill('My draft');
      const items = await (
        await page.request.get(`/api/lists/${listId}`)
      ).json();
      expect(
        (
          await api.put(`/api/track-picks/${items[0]._id}`, {
            data: { primary_track: '2 + 2 = 5', secondary_track: null },
          })
        ).ok()
      ).toBe(true);
      await expect(
        page.locator('.track-pick-item[data-track="2 + 2 = 5"]')
      ).toHaveAttribute('data-is-primary', 'true');
      expect(
        (
          await api.put(`/api/track-picks/${items[0]._id}`, {
            data: { primary_track: null, secondary_track: null },
          })
        ).ok()
      ).toBe(true);
      await expect(
        page.locator('.track-pick-item[data-track="2 + 2 = 5"]')
      ).toHaveAttribute('data-is-primary', 'false');
      await expect(page.locator('#editComments')).toHaveValue('My draft');
      await page.locator('#mobileEditSaveBtn').click();
      await expect(page.locator('#editComments')).toHaveCount(0);
      await expect(row.locator('.comment-text')).toHaveText('My draft');
      await expect(row.locator('[data-field="primary-track-text"]')).toHaveText(
        'Select Track'
      );
      // Exercise the actual 1024px boundary, not only narrow phone widths.
      await page.setViewportSize({ width: 1023, height: 844 });
      await expect(
        page.locator('.mobile-album-list .album-card').first()
      ).toBeVisible();
      await expect(
        page.locator('[data-track-play-btn="true"]:visible')
      ).toHaveCount(0);
      await page.screenshot({
        path: testInfo.outputPath('reactive-mobile.png'),
      });
      await page.setViewportSize({ width: 1280, height: 800 });
      await expect(row).toBeVisible();
      await row.locator('.comment-text').click();
      await row.locator('textarea').fill('Retryable inline draft');
      await page.route(
        '**/items/*/comment',
        (route) =>
          route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: '{"error":"Temporary failure"}',
          }),
        { times: 1 }
      );
      await row.locator('textarea').press('Enter');
      await expect(row.locator('textarea')).toHaveValue(
        'Retryable inline draft'
      );
      await expect(row.locator('textarea')).toBeEnabled();
      await row.locator('textarea').press('Enter');
      await expect(row.locator('.comment-text')).toHaveText(
        'Retryable inline draft'
      );
      await page.screenshot({
        path: testInfo.outputPath('reactive-desktop.png'),
      });
      expect(errors).toEqual([]);
    } finally {
      await otherPage?.close();
      await api.delete(`/api/lists/${listId}`);
    }
  });
});
