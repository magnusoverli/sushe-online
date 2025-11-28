/**
 * Tests for db/retry-wrapper.js
 * Tests the healthCheck function that verifies database connectivity
 */

const { describe, it, mock, beforeEach } = require('node:test');
const assert = require('node:assert');
const { healthCheck } = require('../db/retry-wrapper.js');

describe('retry-wrapper', () => {
  describe('healthCheck', () => {
    let mockPool;

    beforeEach(() => {
      mockPool = {
        query: mock.fn(),
      };
    });

    it('should return healthy status when database query succeeds', async () => {
      mockPool.query.mock.mockImplementation(() =>
        Promise.resolve({ rows: [{ health_check: 1 }] })
      );

      const result = await healthCheck(mockPool);

      assert.strictEqual(result.status, 'healthy');
      assert.strictEqual(result.database, 'connected');
      assert.strictEqual(typeof result.responseTime, 'number');
      assert.ok(result.responseTime >= 0);
      assert.strictEqual(typeof result.timestamp, 'string');
      assert.ok(result.timestamp.match(/^\d{4}-\d{2}-\d{2}T/)); // ISO format
    });

    it('should call pool.query with correct SQL', async () => {
      mockPool.query.mock.mockImplementation(() =>
        Promise.resolve({ rows: [] })
      );

      await healthCheck(mockPool);

      assert.strictEqual(mockPool.query.mock.calls.length, 1);
      assert.strictEqual(
        mockPool.query.mock.calls[0].arguments[0],
        'SELECT 1 as health_check'
      );
    });

    it('should return unhealthy status when database query fails', async () => {
      const dbError = new Error('Connection refused');
      dbError.code = 'ECONNREFUSED';
      mockPool.query.mock.mockImplementation(() => Promise.reject(dbError));

      const result = await healthCheck(mockPool);

      assert.strictEqual(result.status, 'unhealthy');
      assert.strictEqual(result.database, 'disconnected');
      assert.strictEqual(result.error, 'Connection refused');
      assert.strictEqual(result.code, 'ECONNREFUSED');
      assert.strictEqual(typeof result.timestamp, 'string');
    });

    it('should handle timeout errors', async () => {
      const timeoutError = new Error('Query timeout');
      timeoutError.code = 'ETIMEDOUT';
      mockPool.query.mock.mockImplementation(() =>
        Promise.reject(timeoutError)
      );

      const result = await healthCheck(mockPool);

      assert.strictEqual(result.status, 'unhealthy');
      assert.strictEqual(result.database, 'disconnected');
      assert.strictEqual(result.error, 'Query timeout');
      assert.strictEqual(result.code, 'ETIMEDOUT');
    });

    it('should handle PostgreSQL-specific errors', async () => {
      const pgError = new Error('too many connections');
      pgError.code = '53300';
      mockPool.query.mock.mockImplementation(() => Promise.reject(pgError));

      const result = await healthCheck(mockPool);

      assert.strictEqual(result.status, 'unhealthy');
      assert.strictEqual(result.database, 'disconnected');
      assert.strictEqual(result.error, 'too many connections');
      assert.strictEqual(result.code, '53300');
    });

    it('should handle errors without code property', async () => {
      const genericError = new Error('Unknown error');
      mockPool.query.mock.mockImplementation(() =>
        Promise.reject(genericError)
      );

      const result = await healthCheck(mockPool);

      assert.strictEqual(result.status, 'unhealthy');
      assert.strictEqual(result.database, 'disconnected');
      assert.strictEqual(result.error, 'Unknown error');
      assert.strictEqual(result.code, undefined);
    });

    it('should measure response time accurately', async () => {
      // Simulate a slow query (50ms delay)
      mockPool.query.mock.mockImplementation(
        () =>
          new Promise((resolve) => setTimeout(() => resolve({ rows: [] }), 50))
      );

      const result = await healthCheck(mockPool);

      assert.strictEqual(result.status, 'healthy');
      // Allow small margin for timer imprecision (timers can fire slightly early in some environments)
      assert.ok(
        result.responseTime >= 45,
        `Expected responseTime >= 45, got ${result.responseTime}`
      );
      assert.ok(
        result.responseTime < 200,
        `Expected responseTime < 200, got ${result.responseTime}`
      );
    });

    it('should return valid ISO timestamp on success', async () => {
      mockPool.query.mock.mockImplementation(() =>
        Promise.resolve({ rows: [] })
      );

      const beforeTime = new Date();
      const result = await healthCheck(mockPool);
      const afterTime = new Date();

      const resultTime = new Date(result.timestamp);
      assert.ok(resultTime >= beforeTime);
      assert.ok(resultTime <= afterTime);
    });

    it('should return valid ISO timestamp on failure', async () => {
      mockPool.query.mock.mockImplementation(() =>
        Promise.reject(new Error('fail'))
      );

      const beforeTime = new Date();
      const result = await healthCheck(mockPool);
      const afterTime = new Date();

      const resultTime = new Date(result.timestamp);
      assert.ok(resultTime >= beforeTime);
      assert.ok(resultTime <= afterTime);
    });

    it('should not include responseTime in unhealthy response', async () => {
      mockPool.query.mock.mockImplementation(() =>
        Promise.reject(new Error('fail'))
      );

      const result = await healthCheck(mockPool);

      assert.strictEqual(result.status, 'unhealthy');
      assert.strictEqual('responseTime' in result, false);
    });

    it('should not include error/code in healthy response', async () => {
      mockPool.query.mock.mockImplementation(() =>
        Promise.resolve({ rows: [] })
      );

      const result = await healthCheck(mockPool);

      assert.strictEqual(result.status, 'healthy');
      assert.strictEqual('error' in result, false);
      assert.strictEqual('code' in result, false);
    });
  });
});
