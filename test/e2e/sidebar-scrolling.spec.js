const path = require('node:path');
const ejs = require('ejs');
const { test, expect } = require('@playwright/test');

// Render the production shell without startup requests or account data.
async function loadLayout(page) {
  const html = await ejs.renderFile(
    path.join(__dirname, '../../views/spotify-page.ejs'),
    {
      user: {},
      csrfToken: '',
      asset: (url) => url,
      viteModulePreloads: () => [],
      viteAsset: () => '/empty.js',
      generateAccentCssVars: () => '',
      generateAccentOverrides: () => '',
      headerComponent: () => '<header class="h-16 shrink-0">Header</header>',
      contextMenusComponent: () => '',
      settingsDrawerComponent: () => '',
      modalPortalComponent: () => '',
      safeJsonStringify: JSON.stringify,
    }
  );

  await page.route('**/*', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/layout-test') {
      return route.fulfill({ contentType: 'text/html', body: html });
    }
    if (['/styles/output.css', '/styles/app.css'].includes(pathname)) {
      return route.fulfill({
        contentType: 'text/css',
        path: path.join(__dirname, '../../public', pathname),
      });
    }
    return route.fulfill({ status: 204 });
  });
  await page.goto('/layout-test');
  await page.evaluate(() => {
    const listNav = document.getElementById('listNav');
    for (let year = 2000; year < 2020; year++) {
      const group = document.createElement('li');
      group.className = 'group-section year-group';
      const header = document.createElement('button');
      header.className = 'sidebar-group-header';
      header.textContent = String(year);
      const lists = document.createElement('ul');
      lists.className = 'group-lists sidebar-nested';
      for (let index = 0; index < 5; index++) {
        const item = document.createElement('li');
        item.className = 'sidebar-leaf';
        item.textContent = `List ${index}`;
        lists.append(item);
      }
      header.addEventListener('click', () => {
        lists.hidden = !lists.hidden;
      });
      group.append(header, lists);
      listNav.append(group);
    }

    const albums = document.getElementById('albumContainer');
    albums.replaceChildren();
    for (let index = 0; index < 50; index++) {
      const album = document.createElement('div');
      album.className = 'h-24 shrink-0';
      album.textContent = `Album ${index}`;
      albums.append(album);
    }
  });
}

for (const height of [600, 900]) {
  test(`sidebar overflow preserves album scrolling at ${height}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height });
    await loadLayout(page);

    const albumPane = page.locator('#albumContainer');
    const initialBounds = await albumPane.boundingBox();
    expect(initialBounds.y + initialBounds.height).toBeLessThanOrEqual(height);

    const nav = page.locator('#sidebar nav');
    expect(
      await nav.evaluate(
        (element) => element.scrollHeight > element.clientHeight
      )
    ).toBe(true);
    await nav.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(page.locator('#listNav .sidebar-leaf').last()).toBeInViewport({
      ratio: 1,
    });
    await expect(
      page.locator('#sidebar .sidebar-actions-container')
    ).toBeInViewport({ ratio: 1 });

    await albumPane.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(albumPane.locator(':scope > div').last()).toBeInViewport({
      ratio: 1,
    });

    await page
      .locator('#listNav .sidebar-group-header')
      .evaluateAll((headers) => {
        headers.forEach((header) => header.click());
      });
    expect(await albumPane.boundingBox()).toEqual(initialBounds);
    await expect(albumPane.locator(':scope > div').last()).toBeInViewport({
      ratio: 1,
    });
  });
}
