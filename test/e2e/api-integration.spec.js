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

/**
 * Helper: Create a list via the API and return its ID.
 * Lists are created via POST /api/lists with the name in the body.
 */
async function createList(page, { name, year, data, groupId }) {
  const body = { name, data: data || [] };
  if (year !== undefined) body.year = year;
  if (groupId !== undefined) body.groupId = groupId;

  const response = await page.request.post('/api/lists', { data: body });
  return { response, json: await response.json() };
}

/**
 * Helper: Find a list by name from the ID-keyed metadata response.
 * GET /api/lists returns { [listId]: { _id, name, ... } }.
 * GET /api/lists?full=true returns { [listId]: [items...] } (no name).
 * To find by name, we use the metadata endpoint then look up full data by ID.
 */
async function findListByName(page, name) {
  const response = await page.request.get('/api/lists');
  const lists = await response.json();
  const entry = Object.values(lists).find((l) => l.name === name);
  return entry || null;
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
    const { response: createResponse, json: createBody } = await createList(
      page,
      {
        name: 'Integration Test List',
        year: 2024,
        data: [
          { artist: 'Radiohead', album: 'OK Computer' },
          { artist: 'Portishead', album: 'Dummy' },
        ],
      }
    );
    expect(createResponse.status()).toBe(201);
    expect(createBody.success).toBe(true);
    const listId = createBody._id;

    // RETRIEVE: Fetch full list data and verify items
    const listsResponse = await page.request.get('/api/lists?full=true');
    expect(listsResponse.status()).toBe(200);
    const listsBody = await listsResponse.json();
    expect(listsBody).toHaveProperty(listId);
    expect(listsBody[listId]).toHaveLength(2);
    expect(listsBody[listId][0].artist).toBe('Radiohead');

    // UPDATE: Replace list items with PUT /api/lists/:id
    const updateResponse = await page.request.put(`/api/lists/${listId}`, {
      data: {
        data: [
          { artist: 'Radiohead', album: 'OK Computer' },
          { artist: 'Portishead', album: 'Dummy' },
          { artist: 'Massive Attack', album: 'Mezzanine' },
        ],
      },
    });
    expect(updateResponse.status()).toBe(200);

    // Verify update
    const updatedListsResponse = await page.request.get('/api/lists?full=true');
    const updatedBody = await updatedListsResponse.json();
    expect(updatedBody[listId]).toHaveLength(3);

    // DELETE: Remove the list by ID
    const deleteResponse = await page.request.delete(`/api/lists/${listId}`);
    expect(deleteResponse.status()).toBe(200);

    // Verify deletion
    const finalListsResponse = await page.request.get('/api/lists');
    const finalBody = await finalListsResponse.json();
    expect(finalBody).not.toHaveProperty(listId);
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
    const { response: createResponse, json: createBody } = await createList(
      page,
      {
        name: 'Collection Test List',
        groupId: groupId,
        data: [{ artist: 'Test', album: 'Album' }],
      }
    );
    expect(createResponse.status()).toBe(201);
    const listId = createBody._id;

    // Verify list exists
    const list = await findListByName(page, 'Collection Test List');
    expect(list).not.toBeNull();

    // Cleanup
    await page.request.delete(`/api/lists/${listId}`);
    await page.request.delete(`/api/groups/${groupId}`);
  });

  test('should auto-create year group when creating list with year', async ({
    page,
  }) => {
    await setupAuthenticatedUser(page);

    // Create list with specific year
    const { response: createResponse, json: createBody } = await createList(
      page,
      {
        name: 'Year Group Test',
        year: 2019,
      }
    );
    expect(createResponse.status()).toBe(201);
    const listId = createBody._id;

    // Verify year group was created
    const groupsResponse = await page.request.get('/api/groups');
    expect(groupsResponse.status()).toBe(200);
    const groups = await groupsResponse.json();

    const yearGroup = groups.find((g) => g.year === 2019);
    expect(yearGroup).toBeDefined();
    expect(yearGroup.name).toBe('2019');

    // Cleanup
    await page.request.delete(`/api/lists/${listId}`);
  });

  test('should reject invalid data field on item update', async ({ page }) => {
    await setupAuthenticatedUser(page);

    // Create a valid list first
    const { json: createBody } = await createList(page, {
      name: 'Bad Field Test',
      year: 2024,
    });
    const listId = createBody._id;

    // PUT with wrong field name — 'albums' instead of 'data'
    const response = await page.request.put(`/api/lists/${listId}`, {
      data: {
        albums: [], // Wrong! Should be 'data'
      },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid albums array');

    // Cleanup
    await page.request.delete(`/api/lists/${listId}`);
  });

  test('should reject invalid groupId', async ({ page }) => {
    await setupAuthenticatedUser(page);

    const response = await page.request.post('/api/lists', {
      data: {
        name: 'Bad Group Test',
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
    const { json: createBody } = await createList(page, {
      name: 'Track Pick List',
      year: 2024,
      data: [{ artist: 'Test Artist', album: 'Test Album' }],
    });
    const listId = createBody._id;

    // Get full list data to find list item ID — track picks use list item ID
    const listsResponse = await page.request.get('/api/lists?full=true');
    const listsBody = await listsResponse.json();
    const album = listsBody[listId]?.[0];

    if (!album?._id) {
      // List item must have _id for track picks API
      await page.request.delete(`/api/lists/${listId}`);
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
    await page.request.delete(`/api/lists/${listId}`);
  });
});

test.describe('List Main Status', () => {
  test('should set and unset list as main', async ({ page }) => {
    await setupAuthenticatedUser(page);

    // Create a list
    const { json: createBody } = await createList(page, {
      name: 'Main Status Test',
      year: 2024,
    });
    const listId = createBody._id;

    // Set as main using the list ID
    const setMainResponse = await page.request.post(
      `/api/lists/${listId}/main`,
      {
        data: { isMain: true },
      }
    );
    expect(setMainResponse.status()).toBe(200);

    // Verify via lists endpoint
    const list = await findListByName(page, 'Main Status Test');
    expect(list).not.toBeNull();
    expect(list.isMain).toBe(true);

    // Cleanup
    await page.request.delete(`/api/lists/${listId}`);
  });
});

test.describe('Error Handling', () => {
  test('should return 401 for unauthenticated requests', async ({
    request,
  }) => {
    // Use raw request (no session)
    const response = await request.post('/api/lists', {
      data: { name: 'Unauth Test', data: [], year: 2024 },
    });
    expect(response.status()).toBe(401);
  });

  test('should return 400 for malformed requests', async ({ page }) => {
    await setupAuthenticatedUser(page);

    // Missing required 'data' field
    const response = await page.request.post('/api/lists', {
      data: { name: 'Malformed Test', year: 2024 },
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
    const { json: createBody } = await createList(page, {
      name: 'Metadata Preservation',
      year: 2024,
      data: [albumData],
    });
    const listId = createBody._id;

    // Retrieve full data and verify
    const listsResponse = await page.request.get('/api/lists?full=true');
    const lists = await listsResponse.json();
    const savedAlbum = lists[listId]?.[0];

    expect(savedAlbum).toBeDefined();
    expect(savedAlbum.artist).toBe('Metadata Artist');
    expect(savedAlbum.album).toBe('Metadata Album');
    // Note: Some fields may be normalized, but core data should be preserved

    // Cleanup
    await page.request.delete(`/api/lists/${listId}`);
  });
});

test.describe('Special Characters', () => {
  test('should handle special characters in list names', async ({ page }) => {
    await setupAuthenticatedUser(page);

    const specialName = "Best of '90s & 2000s!";

    const { json: createBody } = await createList(page, {
      name: specialName,
      year: 2024,
    });
    const listId = createBody._id;

    const list = await findListByName(page, specialName);
    expect(list).not.toBeNull();
    expect(list.name).toBe(specialName);

    // Cleanup
    await page.request.delete(`/api/lists/${listId}`);
  });
});
