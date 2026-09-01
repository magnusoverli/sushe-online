const { test, expect } = require('@playwright/test');

const SIDEBAR_FIXTURE = `
  <link rel="stylesheet" href="/styles/output.css">
  <link rel="stylesheet" href="/styles/app.css">
  <div class="group-section year-group">
    <div class="group-header-wrapper flex items-center">
      <button id="groupHeader" class="group-header-btn sidebar-group-header flex-1">2025</button>
      <button id="groupMenu" class="sidebar-menu-trigger">...</button>
    </div>
    <ul class="group-lists sidebar-nested">
      <li class="sidebar-leaf-row flex items-center">
        <button id="listLeaf" class="sidebar-list-btn sidebar-leaf flex-1">
          <span class="sidebar-label">A long readable list name</span>
          <span class="sidebar-count">42</span>
        </button>
        <button id="listMenu" class="sidebar-menu-trigger">...</button>
      </li>
    </ul>
  </div>`;

async function getSidebarDimensions(page, viewport) {
  await page.setViewportSize(viewport);
  await page.goto('/login');
  await page.setContent(SIDEBAR_FIXTURE);
  await page.waitForFunction(
    () =>
      window.getComputedStyle(document.querySelector('#listLeaf')).minHeight !==
      '0px'
  );

  return page.evaluate(() =>
    Object.fromEntries(
      ['groupHeader', 'groupMenu', 'listLeaf', 'listMenu'].map((id) => {
        const rect = document.querySelector(`#${id}`).getBoundingClientRect();
        return [id, { width: rect.width, height: rect.height }];
      })
    )
  );
}

test.describe('sidebar density', () => {
  test('uses compact rows on desktop', async ({ page }) => {
    const dimensions = await getSidebarDimensions(page, {
      width: 1280,
      height: 800,
    });

    expect(dimensions.groupHeader.height).toBe(30);
    expect(dimensions.listLeaf.height).toBe(32);
    expect(dimensions.groupMenu.height).toBe(32);
    expect(dimensions.listMenu.height).toBe(32);
  });

  test('preserves mobile touch targets', async ({ page }) => {
    const dimensions = await getSidebarDimensions(page, {
      width: 390,
      height: 844,
    });

    expect(dimensions.groupHeader.height).toBe(40);
    expect(dimensions.listLeaf.height).toBe(40);
    expect(dimensions.groupMenu.height).toBe(44);
    expect(dimensions.listMenu.height).toBe(44);
  });
});
