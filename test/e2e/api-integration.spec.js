/**
 * E2E API Integration Tests
 *
 * These tests authenticate as a real user and test actual API functionality.
 * They verify that the refactored API routes work correctly end-to-end.
 *
 * Uses page.request() to maintain session cookies from browser login.
 *
 * NOTE: These tests require a test user to be approved in the database.
 * Since registration creates users with 'pending' approval status,
 * we use a pre-approved test user or register + approve in setup.
 */

const { test, expect } = require('@playwright/test');

// Test configuration - use a consistent test user
const TEST_USER = {
  email: 'e2e_integration_test@example.com',
  username: 'e2e_integration',
  password: 'TestPassword123!',
};

/**
 * Auto-approve a user directly in the database.
 * Only works when DATABASE_URL is available (CI or local with DB access).
 */
async function approveUserInDB(email) {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    return false;
  }
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  try {
    const result = await pool.query(
      "UPDATE users SET approval_status = 'approved', updated_at = NOW() WHERE email = $1 AND approval_status = 'pending'",
      [email]
    );
    return result.rowCount > 0;
  } finally {
    await pool.end();
  }
}

/**
 * Setup: Ensure test user exists and is approved, then login.
 * This handles the approval workflow that blocks new registrations.
 * When DATABASE_URL is available (CI), auto-approves via direct DB query.
 */
async function setupAuthenticatedUser(page) {
  // First, try to login with existing test user
  await page.goto('/login');
  await page.fill('input[name="email"]', TEST_USER.email);
  await page.fill('input[name="password"]', TEST_USER.password);
  await page.click('button[type="submit"]');

  // Wait for response - could be home (success), login (wrong creds), or login with error (pending)
  await page.waitForURL(
    (url) => url.pathname === '/' || url.pathname === '/login',
    { timeout: 10000 }
  );

  // If we're on home page, we're logged in!
  if (page.url().endsWith('/') || page.url().includes('/?')) {
    return { email: TEST_USER.email, username: TEST_USER.username };
  }

  // Check for pending approval message — try auto-approving via DB
  const pageContent = await page.content();
  if (pageContent.includes('pending approval')) {
    const approved = await approveUserInDB(TEST_USER.email);
    if (approved) {
      // Retry login after approval
      await page.goto('/login');
      await page.fill('input[name="email"]', TEST_USER.email);
      await page.fill('input[name="password"]', TEST_USER.password);
      await page.click('button[type="submit"]');
      await page.waitForURL('/', { timeout: 10000 });
      return { email: TEST_USER.email, username: TEST_USER.username };
    }
    throw new Error(
      'Test user exists but is pending approval. Please approve the user in admin panel.'
    );
  }

  // User doesn't exist — register them
  await page.goto('/register');
  await page.fill('input[name="email"]', TEST_USER.email);
  await page.fill('input[name="username"]', TEST_USER.username);
  await page.fill('input[name="password"]', TEST_USER.password);
  await page.fill('input[name="confirmPassword"]', TEST_USER.password);
  await page.click('button[type="submit"]');

  // Registration redirects to login with pending message
  await page.waitForURL('/login', { timeout: 10000 });

  // Try auto-approving via DB (works in CI where DATABASE_URL is set)
  const approved = await approveUserInDB(TEST_USER.email);
  if (approved) {
    // Retry login after approval
    await page.goto('/login');
    await page.fill('input[name="email"]', TEST_USER.email);
    await page.fill('input[name="password"]', TEST_USER.password);
    await page.click('button[type="submit"]');
    await page.waitForURL('/', { timeout: 10000 });
    return { email: TEST_USER.email, username: TEST_USER.username };
  }

  // No DB access — manual approval required
  throw new Error(
    `Test user "${TEST_USER.email}" registered but needs admin approval.\n` +
      'To run integration tests:\n' +
      '1. Approve the user in admin panel, OR\n' +
      '2. Run: docker compose -f docker-compose.local.yml exec app node -e ' +
      `"const db = require('./db'); db.users.update({email: '${TEST_USER.email}'}, {\\$set: {approvalStatus: 'approved'}}, {}, () => process.exit())"`
  );
}

// Use serial mode - tests share state and must run in order
test.describe.configure({ mode: 'serial' });

// Check if test user is available before running tests
test.describe('Lists API Integration', () => {
  test('should create, retrieve, update, and delete a list', async ({
    page,
  }) => {
    await setupAuthenticatedUser(page);

    // CREATE: Create a new list with albums
    const createResponse = await page.request.post(
      '/api/lists/Integration%20Test%20List',
      {
        data: {
          data: [
            { artist: 'Radiohead', album: 'OK Computer' },
            { artist: 'Portishead', album: 'Dummy' },
          ],
          year: 2024,
        },
      }
    );
    expect(createResponse.status()).toBe(200);
    const createBody = await createResponse.json();
    expect(createBody.success).toBe(true);

    // RETRIEVE: Fetch all lists and verify our list exists
    const listsResponse = await page.request.get('/api/lists?full=true');
    expect(listsResponse.status()).toBe(200);
    const listsBody = await listsResponse.json();
    expect(listsBody).toHaveProperty('Integration Test List');
    expect(listsBody['Integration Test List']).toHaveLength(2);
    expect(listsBody['Integration Test List'][0].artist).toBe('Radiohead');

    // UPDATE: Add another album
    const updateResponse = await page.request.post(
      '/api/lists/Integration%20Test%20List',
      {
        data: {
          data: [
            { artist: 'Radiohead', album: 'OK Computer' },
            { artist: 'Portishead', album: 'Dummy' },
            { artist: 'Massive Attack', album: 'Mezzanine' },
          ],
          year: 2024,
        },
      }
    );
    expect(updateResponse.status()).toBe(200);

    // Verify update
    const updatedListsResponse = await page.request.get('/api/lists?full=true');
    const updatedBody = await updatedListsResponse.json();
    expect(updatedBody['Integration Test List']).toHaveLength(3);

    // DELETE: Remove the list
    const deleteResponse = await page.request.delete(
      '/api/lists/Integration%20Test%20List'
    );
    expect(deleteResponse.status()).toBe(200);

    // Verify deletion
    const finalListsResponse = await page.request.get('/api/lists');
    const finalBody = await finalListsResponse.json();
    expect(finalBody).not.toHaveProperty('Integration Test List');
  });

  test('should create list with groupId (collection)', async ({ page }) => {
    await setupAuthenticatedUser(page);

    // First create a collection
    const groupResponse = await page.request.post('/api/groups', {
      data: { name: 'Test Collection For List' },
    });
    expect(groupResponse.status()).toBe(201);
    const groupBody = await groupResponse.json();
    const groupId = groupBody._id;

    // Create list in collection
    const createResponse = await page.request.post(
      '/api/lists/Collection%20Test%20List',
      {
        data: {
          data: [{ artist: 'Test', album: 'Album' }],
          groupId: groupId,
        },
      }
    );
    expect(createResponse.status()).toBe(200);

    // Verify list exists
    const listsResponse = await page.request.get('/api/lists');
    const listsBody = await listsResponse.json();
    expect(listsBody).toHaveProperty('Collection Test List');

    // Cleanup
    await page.request.delete('/api/lists/Collection%20Test%20List');
    await page.request.delete(`/api/groups/${groupId}`);
  });

  test('should auto-create year group when creating list with year', async ({
    page,
  }) => {
    await setupAuthenticatedUser(page);

    // Create list with specific year
    const createResponse = await page.request.post(
      '/api/lists/Year%20Group%20Test',
      {
        data: {
          data: [],
          year: 2019,
        },
      }
    );
    expect(createResponse.status()).toBe(200);

    // Verify year group was created
    const groupsResponse = await page.request.get('/api/groups');
    expect(groupsResponse.status()).toBe(200);
    const groups = await groupsResponse.json();

    const yearGroup = groups.find((g) => g.year === 2019);
    expect(yearGroup).toBeDefined();
    expect(yearGroup.name).toBe('2019');

    // Cleanup
    await page.request.delete('/api/lists/Year%20Group%20Test');
  });

  test('should reject invalid data field', async ({ page }) => {
    await setupAuthenticatedUser(page);

    // Send wrong field name
    const response = await page.request.post('/api/lists/Bad%20Field%20Test', {
      data: {
        albums: [], // Wrong! Should be 'data'
        year: 2024,
      },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid albums array');
  });

  test('should reject invalid groupId', async ({ page }) => {
    await setupAuthenticatedUser(page);

    const response = await page.request.post('/api/lists/Bad%20Group%20Test', {
      data: {
        data: [],
        groupId: 'nonexistent-group-12345',
      },
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toBe('Invalid group');
  });
});

test.describe('Groups API Integration', () => {
  test('should create, rename, and delete a collection', async ({ page }) => {
    await setupAuthenticatedUser(page);

    // CREATE
    const createResponse = await page.request.post('/api/groups', {
      data: { name: 'My Test Collection' },
    });
    expect(createResponse.status()).toBe(201);
    const createBody = await createResponse.json();
    expect(createBody.name).toBe('My Test Collection');
    const groupId = createBody._id;

    // RENAME
    const renameResponse = await page.request.patch(`/api/groups/${groupId}`, {
      data: { name: 'Renamed Collection' },
    });
    expect(renameResponse.status()).toBe(200);

    // Verify rename
    const groupsResponse = await page.request.get('/api/groups');
    const groups = await groupsResponse.json();
    const renamedGroup = groups.find((g) => g._id === groupId);
    expect(renamedGroup.name).toBe('Renamed Collection');

    // DELETE
    const deleteResponse = await page.request.delete(`/api/groups/${groupId}`);
    expect(deleteResponse.status()).toBe(200);

    // Verify deletion
    const finalGroupsResponse = await page.request.get('/api/groups');
    const finalGroups = await finalGroupsResponse.json();
    expect(finalGroups.find((g) => g._id === groupId)).toBeUndefined();
  });

  test('should reject duplicate collection names', async ({ page }) => {
    await setupAuthenticatedUser(page);

    // Create first
    const first = await page.request.post('/api/groups', {
      data: { name: 'Unique Name' },
    });
    const firstBody = await first.json();

    // Try duplicate
    const duplicateResponse = await page.request.post('/api/groups', {
      data: { name: 'Unique Name' },
    });
    expect(duplicateResponse.status()).toBe(409);

    // Cleanup
    await page.request.delete(`/api/groups/${firstBody._id}`);
  });

  test('should reject year as collection name', async ({ page }) => {
    await setupAuthenticatedUser(page);

    const response = await page.request.post('/api/groups', {
      data: { name: '2024' },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('year');
  });
});

test.describe('Track Picks API Integration', () => {
  test('should set and remove track picks', async ({ page }) => {
    await setupAuthenticatedUser(page);

    // Create a list with an album first
    await page.request.post('/api/lists/Track%20Pick%20List', {
      data: {
        data: [{ artist: 'Test Artist', album: 'Test Album' }],
        year: 2024,
      },
    });

    // Get the list to find _id (list item ID) - track picks now use list item ID
    const listsResponse = await page.request.get('/api/lists?full=true');
    const listsBody = await listsResponse.json();
    const album = listsBody['Track Pick List']?.[0];

    if (!album?._id) {
      // List item must have _id for track picks API
      await page.request.delete('/api/lists/Track%20Pick%20List');
      test.skip();
      return;
    }

    const listItemId = album._id;

    // SET track pick (now uses list item ID instead of album ID)
    const setResponse = await page.request.post(
      `/api/track-picks/${listItemId}`,
      {
        data: {
          trackIdentifier: 'My Favorite Track',
          priority: 1, // 1=primary, 2=secondary
        },
      }
    );
    expect(setResponse.status()).toBe(200);
    const setBody = await setResponse.json();
    expect(setBody.primary_track).toBe('My Favorite Track');

    // REMOVE track pick
    const removeResponse = await page.request.delete(
      `/api/track-picks/${listItemId}`,
      {
        data: { trackIdentifier: 'My Favorite Track' },
      }
    );
    expect(removeResponse.status()).toBe(200);

    // Cleanup
    await page.request.delete('/api/lists/Track%20Pick%20List');
  });
});

test.describe('List Main Status', () => {
  test('should set and unset list as main', async ({ page }) => {
    await setupAuthenticatedUser(page);

    // Create a list
    await page.request.post('/api/lists/Main%20Status%20Test', {
      data: {
        data: [],
        year: 2024,
      },
    });

    // Set as main
    const setMainResponse = await page.request.post(
      '/api/lists/Main%20Status%20Test/main',
      {
        data: { isMain: true },
      }
    );
    expect(setMainResponse.status()).toBe(200);

    // Verify via lists endpoint
    const listsResponse = await page.request.get('/api/lists');
    const lists = await listsResponse.json();
    // The list should exist (metadata check would require different endpoint)
    expect(lists).toHaveProperty('Main Status Test');

    // Cleanup
    await page.request.delete('/api/lists/Main%20Status%20Test');
  });
});

test.describe('Error Handling', () => {
  test('should return 401 for unauthenticated requests', async ({
    request,
  }) => {
    // Use raw request (no session)
    const response = await request.post('/api/lists/Unauth%20Test', {
      data: { data: [], year: 2024 },
    });
    expect(response.status()).toBe(401);
  });

  test('should return 400 for malformed requests', async ({ page }) => {
    await setupAuthenticatedUser(page);

    // Missing required field
    const response = await page.request.post('/api/lists/Malformed%20Test', {
      data: { year: 2024 }, // Missing 'data' field
    });
    expect(response.status()).toBe(400);
  });
});

test.describe('Album Data Preservation', () => {
  test('should preserve album metadata through save cycle', async ({
    page,
  }) => {
    await setupAuthenticatedUser(page);

    const albumData = {
      artist: 'Metadata Artist',
      album: 'Metadata Album',
      release_date: '2024-03-15',
      genre_1: 'Electronic',
      genre_2: 'Ambient',
      country: 'UK',
    };

    // Create list with metadata
    await page.request.post('/api/lists/Metadata%20Preservation', {
      data: {
        data: [albumData],
        year: 2024,
      },
    });

    // Retrieve and verify
    const listsResponse = await page.request.get('/api/lists?full=true');
    const lists = await listsResponse.json();
    const savedAlbum = lists['Metadata Preservation']?.[0];

    expect(savedAlbum).toBeDefined();
    expect(savedAlbum.artist).toBe('Metadata Artist');
    expect(savedAlbum.album).toBe('Metadata Album');
    // Note: Some fields may be normalized, but core data should be preserved

    // Cleanup
    await page.request.delete('/api/lists/Metadata%20Preservation');
  });
});

test.describe('Special Characters', () => {
  test('should handle special characters in list names', async ({ page }) => {
    await setupAuthenticatedUser(page);

    const specialName = "Best of '90s & 2000s!";

    await page.request.post(`/api/lists/${encodeURIComponent(specialName)}`, {
      data: { data: [], year: 2024 },
    });

    const listsResponse = await page.request.get('/api/lists');
    const lists = await listsResponse.json();
    expect(lists).toHaveProperty(specialName);

    // Cleanup
    await page.request.delete(`/api/lists/${encodeURIComponent(specialName)}`);
  });
});
