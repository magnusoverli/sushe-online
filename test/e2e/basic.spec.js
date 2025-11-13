
const { test, expect } = require('@playwright/test');

test.describe('Authentication Flow', () => {
  test('should redirect unauthenticated users to login', async ({ page }) => {
    await page.goto('/');

    
    await expect(page).toHaveURL(/.*\/login/);
    await expect(page).toHaveTitle(/SuShe Online/);
  });

  test('login page should be accessible and functional', async ({ page }) => {
    await page.goto('/login');

    
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();

    
    await expect(page.locator('input[name="_csrf"]')).toBeVisible();

    
    await expect(page.locator('a[href="/register"]')).toBeVisible();
    await expect(page.locator('a[href="/forgot"]')).toBeVisible();
  });

  test('registration page should be accessible and functional', async ({
    page,
  }) => {
    await page.goto('/register');

    
    await expect(page.locator('input[name="username"]')).toBeVisible();
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('input[name="confirmPassword"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();

    
    await expect(page.locator('input[name="_csrf"]')).toBeVisible();
  });

  test('should validate registration form', async ({ page }) => {
    await page.goto('/register');

    
    await page.click('button[type="submit"]');

    
    await expect(page).toHaveURL(/.*\/register/);
  });

  test('should validate login form', async ({ page }) => {
    await page.goto('/login');

    
    await page.click('button[type="submit"]');

    
    await expect(page).toHaveURL(/.*\/login/);
  });
});

test.describe('User Registration Flow', () => {
  test('should complete full registration process', async ({ page }) => {
    await page.goto('/register');

    
    await page.fill('input[name="email"]', `test${Date.now()}@example.com`);
    await page.fill('input[name="username"]', `testuser${Date.now()}`);
    await page.fill('input[name="password"]', 'password123');
    await page.fill('input[name="confirmPassword"]', 'password123');

    
    await page.click('button[type="submit"]');

    
    await expect(page).toHaveURL(/.*\/login/);

    
    
  });

  test('should reject invalid email formats', async ({ page }) => {
    await page.goto('/register');

    await page.fill('input[name="email"]', 'invalid-email');
    await page.fill('input[name="username"]', 'testuser');
    await page.fill('input[name="password"]', 'password123');
    await page.fill('input[name="confirmPassword"]', 'password123');

    await page.click('button[type="submit"]');

    
    await expect(page).toHaveURL(/.*\/register/);
  });

  test('should reject mismatched passwords', async ({ page }) => {
    await page.goto('/register');

    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="username"]', 'testuser');
    await page.fill('input[name="password"]', 'password123');
    await page.fill('input[name="confirmPassword"]', 'different123');

    await page.click('button[type="submit"]');

    
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

    
    await expect(page).toHaveURL(/.*\/forgot/);
  });
});

test.describe('Navigation and UI', () => {
  test('should handle 404 pages gracefully', async ({ page }) => {
    const response = await page.goto('/nonexistent-page');

    
    expect(response?.status()).toBe(404);
  });

  test('should be responsive on mobile', async ({ page }) => {
    
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/login');

    
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('should be responsive on tablet', async ({ page }) => {
    
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/login');

    
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

    
    const csrfToken = await page
      .locator('input[name="_csrf"]')
      .getAttribute('value');
    expect(csrfToken).toBeTruthy();
    expect(csrfToken?.length).toBeGreaterThan(10);
  });

  test('should have security headers', async ({ page }) => {
    const response = await page.goto('/login');

    
    const headers = response?.headers();
    expect(headers?.['x-frame-options']).toBeTruthy();
    expect(headers?.['x-content-type-options']).toBeTruthy();
    expect(headers?.['content-security-policy']).toBeTruthy();
  });

  test('should prevent XSS in form inputs', async ({ page }) => {
    await page.goto('/register');

    
    await page.fill('input[name="username"]', '<script>alert("xss")</script>');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'password123');
    await page.fill('input[name="confirmPassword"]', 'password123');

    await page.click('button[type="submit"]');

    
    
    await expect(page).toHaveURL(/.*\/register/);
  });
});

test.describe('Performance and Accessibility', () => {
  test('should load pages within reasonable time', async ({ page }) => {
    const startTime = Date.now();
    await page.goto('/login');
    const loadTime = Date.now() - startTime;

    
    expect(loadTime).toBeLessThan(3000);
  });

  test('should have accessible form labels', async ({ page }) => {
    await page.goto('/login');

    
    const emailInput = page.locator('input[name="email"]');
    const passwordInput = page.locator('input[name="password"]');

    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();

    
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

    
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    
    const focusedElement = await page.evaluate(
      () => document.activeElement?.tagName
    );
    expect(['INPUT', 'BUTTON'].includes(focusedElement || '')).toBeTruthy();
  });
});

test.describe('Error Handling', () => {
  test('should handle network errors gracefully', async ({ page }) => {
    
    

    const errors = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });

    await page.goto('/login');
    await page.goto('/register');
    await page.goto('/forgot');

    
    expect(errors.length).toBe(0);
  });

  test('should handle missing resources gracefully', async ({ page }) => {
    const failedRequests = [];

    page.on('requestfailed', (request) => {
      failedRequests.push(request.url());
    });

    await page.goto('/login');

    
    
    const criticalFailures = failedRequests.filter(
      (url) =>
        url.includes('.css') || url.includes('.js') || url.includes('/login')
    );

    expect(criticalFailures.length).toBe(0);
  });
});

test.describe('Cross-browser Compatibility', () => {
  test('should work with different user agents', async ({ page }) => {
    
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (compatible; TestBot/1.0)',
    });

    await page.goto('/login');

    
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
  });
});
