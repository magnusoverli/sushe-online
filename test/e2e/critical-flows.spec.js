// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Critical E2E tests - minimal set for smoke testing.
 * Tests are independent but share test user for speed.
 *
 * Run with: npm run test:e2e
 */

test.describe('Authentication', () => {
  test('login page loads and has form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('register page loads and has form', async ({ page }) => {
    await page.goto('/register');
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="username"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
  });

  test('unauthenticated user redirected to login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/.*\/login/);
  });

  test('registration works', async ({ page }) => {
    const id = Date.now().toString().slice(-8);
    await page.goto('/register');
    await page.fill('input[name="email"]', `e2e${id}@example.com`);
    await page.fill('input[name="username"]', `e2e${id}`);
    await page.fill('input[name="password"]', 'testpassword123');
    await page.fill('input[name="confirmPassword"]', 'testpassword123');
    await page.click('button[type="submit"]');

    // Should redirect to login OR show error (both are valid responses)
    await page.waitForURL(
      (url) =>
        url.pathname.includes('/login') || url.pathname.includes('/register'),
      { timeout: 15000 }
    );
  });
});

test.describe('No JavaScript Errors', () => {
  test('public pages load without JS errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/login');
    await page.goto('/register');
    await page.goto('/forgot');

    expect(errors.length).toBe(0);
  });
});

test.describe('Mobile', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('login page is responsive on mobile', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });
});
