const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { Pool } = require('pg');

/**
 * Recommendations Feature Tests
 *
 * Integration tests that require the full app running with database.
 * These tests connect to http://localhost:3000 and require the Docker
 * containers to be running. They are skipped when the server is not available.
 *
 * The recommendations system allows users to recommend albums for a given year.
 * - Any authenticated user can add recommendations (unless access is restricted)
 * - Only admins can remove recommendations
 * - Only first recommender is shown (no duplicates)
 * - Recommendations can be locked/unlocked independently of year locking
 */
describe('Recommendations Feature', () => {
  let app, pool, adminUser, regularUser, regularUser2, testYear, testAlbumId;

  before(async () => {
    // Setup test environment
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

    // Connect to the running app server instead of requiring index.js
    // (requiring index.js starts a server as a side effect and hangs the process)
    app = 'http://localhost:3000';

    testYear = 2024;

    // Create admin user
    adminUser = await createTestUser(pool, {
      email: 'rec-admin@test.com',
      username: 'rec-admin',
      role: 'admin',
    });

    // Create regular users
    regularUser = await createTestUser(pool, {
      email: 'rec-user@test.com',
      username: 'rec-user',
      role: 'user',
    });

    regularUser2 = await createTestUser(pool, {
      email: 'rec-user2@test.com',
      username: 'rec-user2',
      role: 'user',
    });

    // Create a test album
    testAlbumId = await createTestAlbum(pool, {
      artist: 'Test Artist',
      album: 'Test Album',
      release_date: '2024-01-01',
    });
  });

  after(async () => {
    // Cleanup - delete in FK-safe order (recommendation_access references users)
    await pool.query('DELETE FROM recommendation_access WHERE year = $1', [
      testYear,
    ]);
    await pool.query('DELETE FROM recommendations WHERE year = $1', [testYear]);
    await pool.query('DELETE FROM recommendation_settings WHERE year = $1', [
      testYear,
    ]);
    await pool.query("DELETE FROM users WHERE email LIKE 'rec-%@test.com'");
    await pool.query('DELETE FROM albums WHERE album_id = $1', [testAlbumId]);
    await pool.end();
  });

  beforeEach(async () => {
    // Clean recommendations and settings before each test
    await pool.query('DELETE FROM recommendations WHERE year = $1', [testYear]);
    await pool.query('DELETE FROM recommendation_settings WHERE year = $1', [
      testYear,
    ]);
    await pool.query('DELETE FROM recommendation_access WHERE year = $1', [
      testYear,
    ]);
  });

  describe('GET /api/recommendations/:year', () => {
    it('should return empty recommendations for new year', async () => {
      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      const res = await agent
        .get(`/api/recommendations/${testYear}`)
        .expect(200);

      assert.strictEqual(res.body.year, testYear);
      assert.strictEqual(res.body.locked, false);
      assert.ok(Array.isArray(res.body.recommendations));
      assert.strictEqual(res.body.recommendations.length, 0);
    });

    it('should return recommendations with album data, recommender, and reasoning', async () => {
      // Add a recommendation directly
      await addRecommendation(
        pool,
        testYear,
        testAlbumId,
        regularUser._id,
        'This album is fantastic!'
      );

      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      const res = await agent
        .get(`/api/recommendations/${testYear}`)
        .expect(200);

      assert.strictEqual(res.body.recommendations.length, 1);
      const rec = res.body.recommendations[0];
      assert.strictEqual(rec.album_id, testAlbumId);
      assert.strictEqual(rec.recommended_by, regularUser.username);
      assert.strictEqual(rec.reasoning, 'This album is fantastic!');
      assert.ok(rec.recommender_id);
      assert.ok(rec.artist);
      assert.ok(rec.album);
    });

    it('should require authentication', async () => {
      await request(app).get(`/api/recommendations/${testYear}`).expect(401);
    });
  });

  describe('POST /api/recommendations/:year', () => {
    it('should allow adding a recommendation with reasoning', async () => {
      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      const res = await agent
        .post(`/api/recommendations/${testYear}`)
        .send({
          album: {
            artist: 'New Artist',
            album: 'New Album',
            release_date: '2024-06-01',
          },
          reasoning: 'This album is amazing because of the production quality',
        })
        .expect(201);

      assert.strictEqual(res.body.success, true);
      assert.ok(res.body._id);
      assert.ok(res.body.album_id);
      assert.strictEqual(res.body.recommended_by, regularUser.username);
    });

    it('should require reasoning when adding a recommendation', async () => {
      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      const res = await agent
        .post(`/api/recommendations/${testYear}`)
        .send({
          album: {
            artist: 'No Reasoning Artist',
            album: 'No Reasoning Album',
          },
        })
        .expect(400);

      assert.ok(res.body.error.includes('Reasoning is required'));
    });

    it('should reject reasoning over 500 characters', async () => {
      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      const res = await agent
        .post(`/api/recommendations/${testYear}`)
        .send({
          album: {
            artist: 'Long Reasoning Artist',
            album: 'Long Reasoning Album',
          },
          reasoning: 'x'.repeat(501),
        })
        .expect(400);

      assert.ok(res.body.error.includes('500 characters'));
    });

    it('should prevent duplicate recommendations', async () => {
      // Add first recommendation
      await addRecommendation(pool, testYear, testAlbumId, regularUser._id);

      const agent = request.agent(app);
      await loginAs(agent, regularUser2);

      // Try to add same album again
      const res = await agent
        .post(`/api/recommendations/${testYear}`)
        .send({
          album: {
            artist: 'Test Artist',
            album: 'Test Album',
            album_id: testAlbumId,
          },
          reasoning: 'Also great',
        })
        .expect(409);

      assert.ok(res.body.error.includes('already recommended'));
      assert.strictEqual(res.body.recommended_by, regularUser.username);
    });

    it('should prevent adding when recommendations are locked', async () => {
      // Lock recommendations
      await lockRecommendations(pool, testYear);

      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      const res = await agent
        .post(`/api/recommendations/${testYear}`)
        .send({
          album: {
            artist: 'Locked Artist',
            album: 'Locked Album',
          },
          reasoning: 'Great album',
        })
        .expect(403);

      assert.strictEqual(res.body.locked, true);
    });
  });

  describe('DELETE /api/recommendations/:year/:albumId', () => {
    it('should allow admin to remove a recommendation', async () => {
      // Add a recommendation
      await addRecommendation(pool, testYear, testAlbumId, regularUser._id);

      const agent = request.agent(app);
      await loginAs(agent, adminUser);

      const res = await agent
        .delete(`/api/recommendations/${testYear}/${testAlbumId}`)
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.removed, true);

      // Verify removal
      const check = await pool.query(
        'SELECT * FROM recommendations WHERE year = $1 AND album_id = $2',
        [testYear, testAlbumId]
      );
      assert.strictEqual(check.rows.length, 0);
    });

    it('should reject non-admin removal attempts', async () => {
      // Add a recommendation
      await addRecommendation(pool, testYear, testAlbumId, regularUser._id);

      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      await agent
        .delete(`/api/recommendations/${testYear}/${testAlbumId}`)
        .expect(403);
    });
  });

  describe('PATCH /api/recommendations/:year/:albumId/reasoning', () => {
    it('should allow recommender to edit their own reasoning', async () => {
      // Add a recommendation
      await addRecommendation(
        pool,
        testYear,
        testAlbumId,
        regularUser._id,
        'Original reasoning'
      );

      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      const res = await agent
        .patch(`/api/recommendations/${testYear}/${testAlbumId}/reasoning`)
        .send({ reasoning: 'Updated reasoning with new thoughts' })
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.strictEqual(
        res.body.reasoning,
        'Updated reasoning with new thoughts'
      );

      // Verify in database
      const result = await pool.query(
        'SELECT reasoning FROM recommendations WHERE year = $1 AND album_id = $2',
        [testYear, testAlbumId]
      );
      assert.strictEqual(
        result.rows[0].reasoning,
        'Updated reasoning with new thoughts'
      );
    });

    it('should reject editing by non-recommender', async () => {
      // Add a recommendation by regularUser
      await addRecommendation(pool, testYear, testAlbumId, regularUser._id);

      // Try to edit as regularUser2
      const agent = request.agent(app);
      await loginAs(agent, regularUser2);

      const res = await agent
        .patch(`/api/recommendations/${testYear}/${testAlbumId}/reasoning`)
        .send({ reasoning: 'Unauthorized edit' })
        .expect(403);

      assert.ok(res.body.error.includes('original recommender'));
    });

    it('should require reasoning in request', async () => {
      await addRecommendation(pool, testYear, testAlbumId, regularUser._id);

      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      const res = await agent
        .patch(`/api/recommendations/${testYear}/${testAlbumId}/reasoning`)
        .send({})
        .expect(400);

      assert.ok(res.body.error.includes('Reasoning is required'));
    });

    it('should reject reasoning over 500 characters', async () => {
      await addRecommendation(pool, testYear, testAlbumId, regularUser._id);

      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      const res = await agent
        .patch(`/api/recommendations/${testYear}/${testAlbumId}/reasoning`)
        .send({ reasoning: 'x'.repeat(501) })
        .expect(400);

      assert.ok(res.body.error.includes('500 characters'));
    });

    it('should return 404 for non-existent recommendation', async () => {
      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      await agent
        .patch(`/api/recommendations/${testYear}/nonexistent-album/reasoning`)
        .send({ reasoning: 'Test' })
        .expect(404);
    });
  });

  describe('Recommendation Locking', () => {
    it('should allow admin to lock recommendations', async () => {
      const agent = request.agent(app);
      await loginAs(agent, adminUser);

      const res = await agent
        .post(`/api/recommendations/${testYear}/lock`)
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.locked, true);

      // Verify in database
      const result = await pool.query(
        'SELECT locked FROM recommendation_settings WHERE year = $1',
        [testYear]
      );
      assert.strictEqual(result.rows[0].locked, true);
    });

    it('should allow admin to unlock recommendations', async () => {
      // First lock
      await lockRecommendations(pool, testYear);

      const agent = request.agent(app);
      await loginAs(agent, adminUser);

      const res = await agent
        .post(`/api/recommendations/${testYear}/unlock`)
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.locked, false);
    });

    it('should reject non-admin lock attempts', async () => {
      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      await agent.post(`/api/recommendations/${testYear}/lock`).expect(403);
    });
  });

  describe('GET /api/recommendations/:year/status', () => {
    it('should return status with lock info and count', async () => {
      // Add a recommendation
      await addRecommendation(pool, testYear, testAlbumId, regularUser._id);

      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      const res = await agent
        .get(`/api/recommendations/${testYear}/status`)
        .expect(200);

      assert.strictEqual(res.body.year, testYear);
      assert.strictEqual(res.body.locked, false);
      assert.strictEqual(res.body.hasAccess, true);
      assert.strictEqual(res.body.count, 1);
    });
  });

  describe('GET /api/recommendations/years', () => {
    it('should return years with recommendations', async () => {
      // Add a recommendation
      await addRecommendation(pool, testYear, testAlbumId, regularUser._id);

      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      const res = await agent.get('/api/recommendations/years').expect(200);

      assert.ok(Array.isArray(res.body.years));
      assert.ok(res.body.years.includes(testYear));
    });
  });

  describe('Access Control', () => {
    it('should allow all users by default (no access restrictions)', async () => {
      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      const res = await agent
        .get(`/api/recommendations/${testYear}/status`)
        .expect(200);

      assert.strictEqual(res.body.hasAccess, true);
    });

    it('should restrict access when users are specified', async () => {
      // Set access to only regularUser
      await pool.query(
        `INSERT INTO recommendation_access (year, user_id, added_by, added_at)
         VALUES ($1, $2, $3, NOW())`,
        [testYear, regularUser._id, adminUser._id]
      );

      // regularUser should have access
      const agent1 = request.agent(app);
      await loginAs(agent1, regularUser);
      const res1 = await agent1
        .get(`/api/recommendations/${testYear}/status`)
        .expect(200);
      assert.strictEqual(res1.body.hasAccess, true);

      // regularUser2 should not have access
      const agent2 = request.agent(app);
      await loginAs(agent2, regularUser2);
      const res2 = await agent2
        .get(`/api/recommendations/${testYear}`)
        .expect(403);
      assert.ok(res2.body.error.includes('Access denied'));
    });

    it('should allow admin to set access list', async () => {
      const agent = request.agent(app);
      await loginAs(agent, adminUser);

      const res = await agent
        .put(`/api/recommendations/${testYear}/access`)
        .send({ userIds: [regularUser._id] })
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.isRestricted, true);
      assert.strictEqual(res.body.userCount, 1);
    });

    it('should clear access restrictions when empty array is passed', async () => {
      // First set some restrictions
      await pool.query(
        `INSERT INTO recommendation_access (year, user_id, added_by, added_at)
         VALUES ($1, $2, $3, NOW())`,
        [testYear, regularUser._id, adminUser._id]
      );

      const agent = request.agent(app);
      await loginAs(agent, adminUser);

      const res = await agent
        .put(`/api/recommendations/${testYear}/access`)
        .send({ userIds: [] })
        .expect(200);

      assert.strictEqual(res.body.isRestricted, false);
    });
  });
});

// Helper functions
async function createTestUser(pool, { email, username, role }) {
  const bcrypt = require('bcryptjs');
  const crypto = require('crypto');

  const hash = await bcrypt.hash('password', 12);
  const userId = crypto.randomBytes(12).toString('hex');

  await pool.query(
    `INSERT INTO users (_id, email, username, hash, role, approval_status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'approved', NOW(), NOW())
     ON CONFLICT (email) DO UPDATE SET role = $5`,
    [userId, email, username, hash, role]
  );

  // Re-query to get the actual ID (in case of conflict update)
  const result = await pool.query('SELECT _id FROM users WHERE email = $1', [
    email,
  ]);

  return { _id: result.rows[0]._id, email, username, role };
}

async function createTestAlbum(pool, { artist, album, release_date }) {
  const crypto = require('crypto');
  const albumId = crypto.randomBytes(12).toString('hex');

  await pool.query(
    `INSERT INTO albums (album_id, artist, album, release_date, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())`,
    [albumId, artist, album, release_date]
  );

  return albumId;
}

async function loginAs(agent, user) {
  // GET /login to obtain CSRF token from the form
  const getRes = await agent.get('/login');
  const csrfMatch = getRes.text.match(/name="_csrf" value="([^"]+)"/);
  const csrfToken = csrfMatch ? csrfMatch[1] : '';

  await agent.post('/login').send({
    _csrf: csrfToken,
    email: user.email,
    password: 'password',
  });
}

async function addRecommendation(
  pool,
  year,
  albumId,
  userId,
  reasoning = 'Test reasoning'
) {
  const crypto = require('crypto');
  const recId = crypto.randomBytes(12).toString('hex');

  await pool.query(
    `INSERT INTO recommendations (_id, year, album_id, recommended_by, reasoning, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [recId, year, albumId, userId, reasoning]
  );

  return recId;
}

async function lockRecommendations(pool, year) {
  await pool.query(
    `INSERT INTO recommendation_settings (year, locked, created_at, updated_at)
     VALUES ($1, TRUE, NOW(), NOW())
     ON CONFLICT (year) DO UPDATE SET locked = TRUE`,
    [year]
  );
}
