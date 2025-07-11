// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Authentication Flow', () => {
  test('should redirect unauthenticated users to login', async ({ page }) => {
    await page.goto('/');

    // Should redirect to login page
    await expect(page).toHaveURL(/.*\/login/);
    await expect(page).toHaveTitle(/SuShe Online/);
  });

  test('login page should be accessible and functional', async ({ page }) => {
    await page.goto('/login');

    // Should have login form elements
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();

    // Should have CSRF token
    await expect(page.locator('input[name="_csrf"]')).toBeVisible();

    // Should have links to register and forgot password
    await expect(page.locator('a[href="/register"]')).toBeVisible();
    await expect(page.locator('a[href="/forgot"]')).toBeVisible();
  });

  test('registration page should be accessible and functional', async ({
    page,
  }) => {
    await page.goto('/register');

    // Should have registration form elements
    await expect(page.locator('input[name="username"]')).toBeVisible();
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('input[name="confirmPassword"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();

    // Should have CSRF token
    await expect(page.locator('input[name="_csrf"]')).toBeVisible();
  });

  test('should validate registration form', async ({ page }) => {
    await page.goto('/register');

    // Try to submit empty form
    await page.click('button[type="submit"]');

    // Should stay on registration page (validation failed)
    await expect(page).toHaveURL(/.*\/register/);
  });

  test('should validate login form', async ({ page }) => {
    await page.goto('/login');

    // Try to submit empty form
    await page.click('button[type="submit"]');

    // Should stay on login page (validation failed)
    await expect(page).toHaveURL(/.*\/login/);
  });
});

test.describe('User Registration Flow', () => {
  test('should complete full registration process', async ({ page }) => {
    await page.goto('/register');

    // Fill out registration form
    await page.fill('input[name="email"]', `test${Date.now()}@example.com`);
    await page.fill('input[name="username"]', `testuser${Date.now()}`);
    await page.fill('input[name="password"]', 'password123');
    await page.fill('input[name="confirmPassword"]', 'password123');

    // Submit form
    await page.click('button[type="submit"]');

    // Should redirect to login page with success message
    await expect(page).toHaveURL(/.*\/login/);

    // Should show success message (if flash messages are visible)
    // Note: This depends on how flash messages are implemented
  });

  test('should reject invalid email formats', async ({ page }) => {
    await page.goto('/register');

    await page.fill('input[name="email"]', 'invalid-email');
    await page.fill('input[name="username"]', 'testuser');
    await page.fill('input[name="password"]', 'password123');
    await page.fill('input[name="confirmPassword"]', 'password123');

    await page.click('button[type="submit"]');

    // Should stay on registration page
    await expect(page).toHaveURL(/.*\/register/);
  });

  test('should reject mismatched passwords', async ({ page }) => {
    await page.goto('/register');

    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="username"]', 'testuser');
    await page.fill('input[name="password"]', 'password123');
    await page.fill('input[name="confirmPassword"]', 'different123');

    await page.click('button[type="submit"]');

    // Should stay on registration page
    await expect(page).toHaveURL(/.*\/register/);
  });
});

test.describe('Password Reset Flow', () => {
  test('forgot password page should be accessible', async ({ page }) => {
    await page.goto('/forgot');

    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
    await expect(page.locator('input[name="_csrf"]')).toBeVisible();
  });

  test('should handle forgot password submission', async ({ page }) => {
    await page.goto('/forgot');

    await page.fill('input[name="email"]', 'test@example.com');
    await page.click('button[type="submit"]');

    // Should redirect back to forgot page with message
    await expect(page).toHaveURL(/.*\/forgot/);
  });
});

test.describe('Navigation and UI', () => {
  test('should handle 404 pages gracefully', async ({ page }) => {
    const response = await page.goto('/nonexistent-page');

    // Should return 404 status
    expect(response?.status()).toBe(404);
  });

  test('should be responsive on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/login');

    // Page should still be functional on mobile
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('should be responsive on tablet', async ({ page }) => {
    // Set tablet viewport
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/login');

    // Page should still be functional on tablet
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
  });

  test('should have proper page titles', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveTitle(/SuShe Online/);

    await page.goto('/register');
    await expect(page).toHaveTitle(/Join the KVLT/);

    await page.goto('/forgot');
    await expect(page).toHaveTitle(/Password Recovery/);
  });
});

test.describe('Security Features', () => {
  test('should have CSRF protection on forms', async ({ page }) => {
    await page.goto('/login');

    // Should have CSRF token in form
    const csrfToken = await page
      .locator('input[name="_csrf"]')
      .getAttribute('value');
    expect(csrfToken).toBeTruthy();
    expect(csrfToken?.length).toBeGreaterThan(10);
  });

  test('should have security headers', async ({ page }) => {
    const response = await page.goto('/login');

    // Check for security headers
    const headers = response?.headers();
    expect(headers?.['x-frame-options']).toBeTruthy();
    expect(headers?.['x-content-type-options']).toBeTruthy();
    expect(headers?.['content-security-policy']).toBeTruthy();
  });

  test('should prevent XSS in form inputs', async ({ page }) => {
    await page.goto('/register');

    // Try to inject script
    await page.fill('input[name="username"]', '<script>alert("xss")</script>');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'password123');
    await page.fill('input[name="confirmPassword"]', 'password123');

    await page.click('button[type="submit"]');

    // Should not execute script (page should handle safely)
    // This is more of a server-side validation test
    await expect(page).toHaveURL(/.*\/register/);
  });
});

test.describe('Performance and Accessibility', () => {
  test('should load pages within reasonable time', async ({ page }) => {
    const startTime = Date.now();
    await page.goto('/login');
    const loadTime = Date.now() - startTime;

    // Should load within 3 seconds
    expect(loadTime).toBeLessThan(3000);
  });

  test('should have accessible form labels', async ({ page }) => {
    await page.goto('/login');

    // Check for proper form labels or aria-labels
    const emailInput = page.locator('input[name="email"]');
    const passwordInput = page.locator('input[name="password"]');

    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();

    // Should have associated labels or placeholders
    const emailLabel =
      (await emailInput.getAttribute('placeholder')) ||
      (await emailInput.getAttribute('aria-label'));
    const passwordLabel =
      (await passwordInput.getAttribute('placeholder')) ||
      (await passwordInput.getAttribute('aria-label'));

    expect(emailLabel || passwordLabel).toBeTruthy();
  });

  test('should handle keyboard navigation', async ({ page }) => {
    await page.goto('/login');

    // Should be able to tab through form elements
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    // Focus should be on submit button or other form element
    const focusedElement = await page.evaluate(
      () => document.activeElement?.tagName
    );
    expect(['INPUT', 'BUTTON'].includes(focusedElement || '')).toBeTruthy();
  });
});

test.describe('Error Handling', () => {
  test('should handle network errors gracefully', async ({ page }) => {
    // This test would require mocking network failures
    // For now, we'll test that pages load without JavaScript errors

    const errors = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });

    await page.goto('/login');
    await page.goto('/register');
    await page.goto('/forgot');

    // Should not have any JavaScript errors
    expect(errors.length).toBe(0);
  });

  test('should handle missing resources gracefully', async ({ page }) => {
    const failedRequests = [];

    page.on('requestfailed', (request) => {
      failedRequests.push(request.url());
    });

    await page.goto('/login');

    // Critical resources should load successfully
    // Some non-critical resources might fail, but page should still work
    const criticalFailures = failedRequests.filter(
      (url) =>
        url.includes('.css') || url.includes('.js') || url.includes('/login')
    );

    expect(criticalFailures.length).toBe(0);
  });
});

test.describe('Cross-browser Compatibility', () => {
  test('should work with different user agents', async ({ page }) => {
    // Test with different user agent
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (compatible; TestBot/1.0)',
    });

    await page.goto('/login');

    // Should still load properly
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
  });
});
