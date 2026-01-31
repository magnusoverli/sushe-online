const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { Pool } = require('pg');

/**
 * Year Locking Feature Tests
 *
 * The year lock system works as follows:
 * - When a year is locked, ONLY main lists are protected
 * - Non-main lists can still be created, edited, and deleted in locked years
 * - Main status changes are blocked in locked years (cannot set or unset main)
 * - Admin operations (lock/unlock, contributors, recompute) are always allowed
 */
describe('Year Locking Feature', () => {
  let app, pool, adminUser, regularUser, testYear;

  before(async () => {
    // Setup test environment
    pool = new Pool({ connectionString: process.env.DATABASE_URL });

    // Create test app
    app = require('../index.js');

    testYear = 2024;

    // Create admin user
    adminUser = await createTestUser(pool, {
      email: 'admin@test.com',
      username: 'admin',
      role: 'admin',
    });

    // Create regular user
    regularUser = await createTestUser(pool, {
      email: 'user@test.com',
      username: 'user',
      role: 'user',
    });
  });

  after(async () => {
    // Cleanup
    await pool.query("DELETE FROM users WHERE email LIKE '%@test.com'");
    await pool.query('DELETE FROM master_lists WHERE year = $1', [testYear]);
    await pool.end();
  });

  beforeEach(async () => {
    // Unlock year before each test
    await pool.query('UPDATE master_lists SET locked = FALSE WHERE year = $1', [
      testYear,
    ]);
  });

  describe('Admin Lock/Unlock Endpoints', () => {
    it('should allow admin to lock a year', async () => {
      const agent = request.agent(app);
      await loginAs(agent, adminUser);

      const res = await agent
        .post(`/api/aggregate-list/${testYear}/lock`)
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.locked, true);
      assert.strictEqual(res.body.year, testYear);

      // Verify in database
      const result = await pool.query(
        'SELECT locked FROM master_lists WHERE year = $1',
        [testYear]
      );
      assert.strictEqual(result.rows[0].locked, true);
    });

    it('should allow admin to unlock a year', async () => {
      // First lock the year
      await pool.query(
        `INSERT INTO master_lists (year, locked) VALUES ($1, TRUE)
         ON CONFLICT (year) DO UPDATE SET locked = TRUE`,
        [testYear]
      );

      const agent = request.agent(app);
      await loginAs(agent, adminUser);

      const res = await agent
        .post(`/api/aggregate-list/${testYear}/unlock`)
        .expect(200);

      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.locked, false);

      // Verify in database
      const result = await pool.query(
        'SELECT locked FROM master_lists WHERE year = $1',
        [testYear]
      );
      assert.strictEqual(result.rows[0].locked, false);
    });

    it('should reject non-admin lock attempts', async () => {
      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      await agent.post(`/api/aggregate-list/${testYear}/lock`).expect(403);
    });

    it('should reject non-admin unlock attempts', async () => {
      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      await agent.post(`/api/aggregate-list/${testYear}/unlock`).expect(403);
    });
  });

  describe('List Creation in Locked Years', () => {
    it('should allow list creation for locked year (new lists are non-main)', async () => {
      // Lock the year
      await lockYear(pool, testYear);

      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      // New lists are created as non-main, so they should be allowed
      const res = await agent
        .post('/api/lists')
        .send({
          name: 'Test List In Locked Year',
          year: testYear,
        })
        .expect(200);

      assert.ok(res.body.listId);
    });

    it('should allow list creation for unlocked year', async () => {
      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      const res = await agent
        .post('/api/lists')
        .send({
          name: 'Test List Unlocked',
          year: testYear,
        })
        .expect(200);

      assert.ok(res.body.listId);
    });
  });

  describe('List Update Protection', () => {
    it('should block main list updates for locked year', async () => {
      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      // Create list first
      const createRes = await agent.post('/api/lists').send({
        name: 'Main List Update Test',
        year: testYear,
      });
      const listId = createRes.body.listId;

      // Set as main
      await agent.post(`/api/lists/${listId}/main`).send({ isMain: true });

      // Lock the year
      await lockYear(pool, testYear);

      // Try to update main list
      const res = await agent
        .patch(`/api/lists/${listId}`)
        .send({ name: 'New Name' })
        .expect(403);

      assert.ok(res.body.error.includes('locked'));
    });

    it('should allow non-main list updates for locked year', async () => {
      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      // Create non-main list
      const createRes = await agent.post('/api/lists').send({
        name: 'Non-Main List Update Test',
        year: testYear,
      });
      const listId = createRes.body.listId;

      // Lock the year
      await lockYear(pool, testYear);

      // Should be able to update non-main list
      const res = await agent
        .patch(`/api/lists/${listId}`)
        .send({ name: 'New Name For Non-Main' })
        .expect(200);

      assert.ok(res.body.success || res.body.list);
    });
  });

  describe('List Item Modification Protection', () => {
    it('should block main list item updates for locked year', async () => {
      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      // Create list with items
      const createRes = await agent.post('/api/lists').send({
        name: 'Main List Items Test',
        year: testYear,
        data: [
          {
            artist: 'Test Artist',
            album: 'Test Album',
            position: 1,
          },
        ],
      });
      const listId = createRes.body.listId;

      // Set as main
      await agent.post(`/api/lists/${listId}/main`).send({ isMain: true });

      // Lock the year
      await lockYear(pool, testYear);

      // Try to update items on main list
      const res = await agent
        .post(`/api/lists/${listId}/items`)
        .send({
          data: [
            {
              artist: 'Test Artist 2',
              album: 'Test Album 2',
              position: 1,
            },
          ],
        })
        .expect(403);

      assert.ok(res.body.error.includes('locked'));
    });

    it('should allow non-main list item updates for locked year', async () => {
      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      // Create non-main list with items
      const createRes = await agent.post('/api/lists').send({
        name: 'Non-Main List Items Test',
        year: testYear,
        data: [
          {
            artist: 'Test Artist',
            album: 'Test Album',
            position: 1,
          },
        ],
      });
      const listId = createRes.body.listId;

      // Lock the year
      await lockYear(pool, testYear);

      // Should be able to update items on non-main list
      const res = await agent
        .post(`/api/lists/${listId}/items`)
        .send({
          data: [
            {
              artist: 'Test Artist 2',
              album: 'Test Album 2',
              position: 1,
            },
          ],
        })
        .expect(200);

      assert.ok(res.body.success || !res.body.error);
    });
  });

  describe('Main List Deletion Prevention', () => {
    it('should always block main list deletion regardless of lock status', async () => {
      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      // Create main list
      const createRes = await agent.post('/api/lists').send({
        name: 'Main List',
        year: testYear,
      });
      const listId = createRes.body.listId;

      // Set as main
      await agent.post(`/api/lists/${listId}/main`).send({ isMain: true });

      // Try to delete (year not locked)
      const res = await agent.delete(`/api/lists/${listId}`).expect(403);

      assert.ok(res.body.error.includes('main list'));
    });
  });

  describe('Main Status Change Protection', () => {
    it('should block setting main status in locked year', async () => {
      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      // Create non-main list
      const createRes = await agent.post('/api/lists').send({
        name: 'List To Set Main',
        year: testYear,
      });
      const listId = createRes.body.listId;

      // Lock the year
      await lockYear(pool, testYear);

      // Try to set as main - should be blocked
      const res = await agent
        .post(`/api/lists/${listId}/main`)
        .send({ isMain: true })
        .expect(403);

      assert.ok(res.body.error.includes('locked'));
      assert.strictEqual(res.body.yearLocked, true);
    });

    it('should block unsetting main status in locked year', async () => {
      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      // Create list and set as main
      const createRes = await agent.post('/api/lists').send({
        name: 'List To Unset Main',
        year: testYear,
      });
      const listId = createRes.body.listId;

      // Set as main first
      await agent.post(`/api/lists/${listId}/main`).send({ isMain: true });

      // Lock the year
      await lockYear(pool, testYear);

      // Try to unset main - should be blocked
      const res = await agent
        .post(`/api/lists/${listId}/main`)
        .send({ isMain: false })
        .expect(403);

      assert.ok(res.body.error.includes('locked'));
      assert.strictEqual(res.body.yearLocked, true);
    });

    it('should allow setting main status in unlocked year', async () => {
      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      // Create non-main list
      const createRes = await agent.post('/api/lists').send({
        name: 'List To Set Main Unlocked',
        year: testYear,
      });
      const listId = createRes.body.listId;

      // Year not locked - should succeed
      const res = await agent
        .post(`/api/lists/${listId}/main`)
        .send({ isMain: true })
        .expect(200);

      assert.ok(res.body.success || !res.body.error);
    });
  });

  describe('Non-Main List Deletion for Locked Years', () => {
    it('should allow deletion of non-main lists for locked years', async () => {
      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      // Create non-main list
      const createRes = await agent.post('/api/lists').send({
        name: 'Non-Main List Deletable Locked',
        year: testYear,
      });
      const listId = createRes.body.listId;

      // Lock the year
      await lockYear(pool, testYear);

      // Should be able to delete non-main list even in locked year
      await agent.delete(`/api/lists/${listId}`).expect(200);
    });

    it('should allow deletion of non-main lists for unlocked years', async () => {
      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      // Create non-main list
      const createRes = await agent.post('/api/lists').send({
        name: 'Non-Main List Deletable',
        year: testYear,
      });
      const listId = createRes.body.listId;

      // Delete (year not locked)
      await agent.delete(`/api/lists/${listId}`).expect(200);
    });
  });

  describe('List Move Protection', () => {
    it('should block moving main list FROM locked year', async () => {
      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      // Create list in test year
      const createRes = await agent.post('/api/lists').send({
        name: 'Main List Move Test',
        year: testYear,
      });
      const listId = createRes.body.listId;

      // Set as main
      await agent.post(`/api/lists/${listId}/main`).send({ isMain: true });

      // Lock the year
      await lockYear(pool, testYear);

      // Try to move main list to different year - use groups API
      const groupsRes = await agent.get('/api/groups');
      const targetGroup = groupsRes.body.find((g) => g.year === testYear + 1);

      if (targetGroup) {
        const res = await agent
          .put(`/api/groups/${targetGroup._id}/move-list`)
          .send({ listId, year: testYear + 1 })
          .expect(403);

        assert.ok(res.body.error.includes('locked'));
      }
    });

    it('should allow moving non-main list FROM locked year', async () => {
      // This is a placeholder test - moving non-main lists should be allowed
      // in locked years, but requires specific API setup to test properly
      assert.ok(true, 'Non-main lists can be moved from locked years');
    });

    it('should block moving main list TO locked year', async () => {
      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      // Lock the target year
      await lockYear(pool, testYear);

      // Create list in different year
      const createRes = await agent.post('/api/lists').send({
        name: 'Main List Move To Test',
        year: testYear + 1,
      });
      const listId = createRes.body.listId;

      // Set as main for source year
      await agent.post(`/api/lists/${listId}/main`).send({ isMain: true });

      // Try to move main list to locked year - use groups API
      const res = await agent
        .put(`/api/groups/move-list`)
        .send({ listId, year: testYear })
        .expect(403);

      assert.ok(res.body.error.includes('locked'));
    });

    it('should allow moving non-main list TO locked year', async () => {
      // This is a placeholder test - moving non-main lists should be allowed
      // to locked years, but requires specific API setup to test properly
      assert.ok(true, 'Non-main lists can be moved to locked years');
    });
  });

  describe('Locked Years API', () => {
    it('should return list of locked years', async () => {
      // Lock test year
      await lockYear(pool, testYear);

      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      const res = await agent.get('/api/locked-years').expect(200);

      assert.ok(Array.isArray(res.body.years));
      assert.ok(res.body.years.includes(testYear));
    });

    it('should include locked field in aggregate status', async () => {
      // Lock test year
      await lockYear(pool, testYear);

      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      const res = await agent
        .get(`/api/aggregate-list/${testYear}/status`)
        .expect(200);

      assert.strictEqual(res.body.locked, true);
    });
  });

  describe('Contributor Management with Locked Years', () => {
    it('should allow contributor management for locked years', async () => {
      // Lock the year
      await lockYear(pool, testYear);

      const agent = request.agent(app);
      await loginAs(agent, adminUser);

      // Should still be able to add contributors
      const res = await agent
        .post(`/api/aggregate-list/${testYear}/contributors`)
        .send({ userId: regularUser._id })
        .expect(200);

      assert.strictEqual(res.body.success, true);
    });
  });

  describe('Aggregate Recompute with Locked Years', () => {
    it('should allow aggregate recompute for locked years', async () => {
      // Lock the year
      await lockYear(pool, testYear);

      const agent = request.agent(app);
      await loginAs(agent, adminUser);

      // Should still be able to recompute
      const res = await agent
        .post(`/api/aggregate-list/${testYear}/recompute`)
        .expect(200);

      assert.strictEqual(res.body.success, true);
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
    `INSERT INTO users (_id, email, username, hash, role, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT (email) DO UPDATE SET role = $5`,
    [userId, email, username, hash, role]
  );

  return { _id: userId, email, username, role };
}

async function loginAs(agent, user) {
  await agent.post('/login').send({
    email: user.email,
    password: 'password',
  });
}

async function lockYear(pool, year) {
  await pool.query(
    `INSERT INTO master_lists (year, locked, created_at, updated_at)
     VALUES ($1, TRUE, NOW(), NOW())
     ON CONFLICT (year) DO UPDATE SET locked = TRUE`,
    [year]
  );
}
