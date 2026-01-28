const { describe, it, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { Pool } = require('pg');

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
    await pool.query('DELETE FROM users WHERE email LIKE \'%@test.com\'');
    await pool.query('DELETE FROM master_lists WHERE year = $1', [testYear]);
    await pool.end();
  });

  beforeEach(async () => {
    // Unlock year before each test
    await pool.query(
      'UPDATE master_lists SET locked = FALSE WHERE year = $1',
      [testYear]
    );
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

  describe('List Creation Protection', () => {
    it('should block list creation for locked year', async () => {
      // Lock the year
      await lockYear(pool, testYear);

      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      const res = await agent
        .post('/api/lists')
        .send({
          name: 'Test List',
          year: testYear,
        })
        .expect(403);

      assert.ok(res.body.error.includes('locked'));
      assert.strictEqual(res.body.yearLocked, true);
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
    it('should block list updates for locked year', async () => {
      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      // Create list first
      const createRes = await agent.post('/api/lists').send({
        name: 'Test List',
        year: testYear,
      });
      const listId = createRes.body.listId;

      // Lock the year
      await lockYear(pool, testYear);

      // Try to update list
      const res = await agent
        .patch(`/api/lists/${listId}`)
        .send({ name: 'New Name' })
        .expect(403);

      assert.ok(res.body.error.includes('locked'));
    });
  });

  describe('List Item Modification Protection', () => {
    it('should block list item updates for locked year', async () => {
      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      // Create list with items
      const createRes = await agent.post('/api/lists').send({
        name: 'Test List',
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

      // Try to update items
      const res = await agent
        .put(`/api/lists/${listId}`)
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

  describe('Non-Main List Deletion for Locked Years', () => {
    it('should block deletion of non-main lists for locked years', async () => {
      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      // Create non-main list
      const createRes = await agent.post('/api/lists').send({
        name: 'Non-Main List',
        year: testYear,
      });
      const listId = createRes.body.listId;

      // Lock the year
      await lockYear(pool, testYear);

      // Try to delete
      const res = await agent.delete(`/api/lists/${listId}`).expect(403);

      assert.ok(res.body.error.includes('locked'));
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
    it('should block moving list FROM locked year', async () => {
      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      // Create list in test year
      const createRes = await agent.post('/api/lists').send({
        name: 'Test List',
        year: testYear,
      });
      const listId = createRes.body.listId;

      // Lock the year
      await lockYear(pool, testYear);

      // Try to move to different year
      const res = await agent
        .post(`/api/lists/${listId}/move`)
        .send({ year: testYear + 1 })
        .expect(403);

      assert.ok(res.body.error.includes('locked'));
    });

    it('should block moving list TO locked year', async () => {
      const agent = request.agent(app);
      await loginAs(agent, regularUser);

      // Lock the target year
      await lockYear(pool, testYear);

      // Create list in different year
      const createRes = await agent.post('/api/lists').send({
        name: 'Test List',
        year: testYear + 1,
      });
      const listId = createRes.body.listId;

      // Try to move to locked year
      const res = await agent
        .post(`/api/lists/${listId}/move`)
        .send({ year: testYear })
        .expect(403);

      assert.ok(res.body.error.includes('locked'));
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
