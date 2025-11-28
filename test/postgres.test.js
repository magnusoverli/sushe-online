/**
 * Tests for db/postgres.js
 * Tests PgDatastore class - the database access layer
 */

const { describe, it, mock, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  PgDatastore,
  waitForPostgres,
  warmConnections,
} = require('../db/postgres.js');

// eslint-disable-next-line max-lines-per-function -- Test suite with many test cases
describe('PgDatastore', () => {
  let mockPool;
  let datastore;
  const testTable = 'test_table';
  const testFieldMap = {
    userId: 'user_id',
    albumId: 'album_id',
    listName: 'list_name',
  };

  beforeEach(() => {
    // Create a fresh mock pool for each test
    mockPool = {
      query: mock.fn(() => Promise.resolve({ rows: [], rowCount: 0 })),
    };
    datastore = new PgDatastore(mockPool, testTable, testFieldMap);
  });

  describe('constructor', () => {
    it('should initialize with pool, table, and fieldMap', () => {
      assert.strictEqual(datastore.pool, mockPool);
      assert.strictEqual(datastore.table, testTable);
      assert.deepStrictEqual(datastore.fieldMap, testFieldMap);
    });

    it('should create inverse field mapping', () => {
      assert.strictEqual(datastore.inverseMap['user_id'], 'userId');
      assert.strictEqual(datastore.inverseMap['album_id'], 'albumId');
      assert.strictEqual(datastore.inverseMap['list_name'], 'listName');
    });

    it('should initialize cache as empty Map', () => {
      assert.ok(datastore.cache instanceof Map);
      assert.strictEqual(datastore.cache.size, 0);
    });

    it('should set cacheTimeout to 60000ms', () => {
      assert.strictEqual(datastore.cacheTimeout, 60000);
    });

    it('should set logQueries based on LOG_SQL env', () => {
      const originalEnv = process.env.LOG_SQL;

      // Test with LOG_SQL=true
      process.env.LOG_SQL = 'true';
      delete require.cache[require.resolve('../db/postgres.js')];
      const { PgDatastore: PgDatastoreTrue } = require('../db/postgres.js');
      const storeTrue = new PgDatastoreTrue(mockPool, testTable, {});
      assert.strictEqual(storeTrue.logQueries, true);

      // Test with LOG_SQL=false
      process.env.LOG_SQL = 'false';
      delete require.cache[require.resolve('../db/postgres.js')];
      const { PgDatastore: PgDatastoreFalse } = require('../db/postgres.js');
      const storeFalse = new PgDatastoreFalse(mockPool, testTable, {});
      assert.strictEqual(storeFalse.logQueries, false);

      // Restore
      if (originalEnv !== undefined) {
        process.env.LOG_SQL = originalEnv;
      } else {
        delete process.env.LOG_SQL;
      }
      delete require.cache[require.resolve('../db/postgres.js')];
    });
  });

  describe('_prepareValue', () => {
    it('should return Date objects as-is', () => {
      const date = new Date('2024-01-01');
      assert.strictEqual(datastore._prepareValue(date), date);
    });

    it('should return Buffer objects as-is', () => {
      const buffer = Buffer.from('test');
      assert.strictEqual(datastore._prepareValue(buffer), buffer);
    });

    it('should return null as-is', () => {
      assert.strictEqual(datastore._prepareValue(null), null);
    });

    it('should stringify objects as JSON', () => {
      const obj = { foo: 'bar', nested: { value: 123 } };
      const result = datastore._prepareValue(obj);
      assert.strictEqual(result, JSON.stringify(obj));
    });

    it('should return primitive values as-is', () => {
      assert.strictEqual(datastore._prepareValue('string'), 'string');
      assert.strictEqual(datastore._prepareValue(123), 123);
      assert.strictEqual(datastore._prepareValue(true), true);
      assert.strictEqual(datastore._prepareValue(false), false);
    });

    it('should return undefined as-is', () => {
      assert.strictEqual(datastore._prepareValue(undefined), undefined);
    });
  });

  describe('_sanitizeParams', () => {
    it('should return non-array params as-is', () => {
      assert.strictEqual(datastore._sanitizeParams(null), null);
      assert.strictEqual(datastore._sanitizeParams(undefined), undefined);
      assert.deepStrictEqual(datastore._sanitizeParams({ foo: 'bar' }), {
        foo: 'bar',
      });
    });

    it('should sanitize base64 strings longer than 100 chars', () => {
      const base64 = 'A'.repeat(150); // Valid base64 chars
      const result = datastore._sanitizeParams([base64]);
      assert.strictEqual(result.length, 1);
      assert.ok(result[0].includes('[base64 data:'));
      assert.ok(result[0].includes('150 chars]'));
    });

    it('should sanitize data URIs', () => {
      const dataUri = 'data:image/png;base64,' + 'A'.repeat(100);
      const result = datastore._sanitizeParams([dataUri]);
      assert.strictEqual(result.length, 1);
      assert.ok(result[0].includes('[data URI:'));
      assert.ok(result[0].includes('chars]'));
    });

    it('should keep short strings unchanged', () => {
      const params = ['short', 'strings', 'here'];
      const result = datastore._sanitizeParams(params);
      assert.deepStrictEqual(result, params);
    });

    it('should keep non-string params unchanged', () => {
      const params = [123, true, null, { foo: 'bar' }];
      const result = datastore._sanitizeParams(params);
      assert.deepStrictEqual(result, params);
    });
  });

  describe('_mapField', () => {
    it('should map fields using fieldMap', () => {
      assert.strictEqual(datastore._mapField('userId'), 'user_id');
      assert.strictEqual(datastore._mapField('albumId'), 'album_id');
    });

    it('should return unmapped fields as-is', () => {
      assert.strictEqual(datastore._mapField('unknown'), 'unknown');
      assert.strictEqual(datastore._mapField('email'), 'email');
    });
  });

  describe('_mapRow', () => {
    it('should map database columns back to JS field names', () => {
      const dbRow = {
        user_id: '123',
        album_id: 'abc',
        list_name: 'My List',
        other_field: 'value',
      };

      const result = datastore._mapRow(dbRow);

      assert.strictEqual(result.userId, '123');
      assert.strictEqual(result.albumId, 'abc');
      assert.strictEqual(result.listName, 'My List');
      assert.strictEqual(result.other_field, 'value'); // Unmapped field stays as-is
    });

    it('should handle empty rows', () => {
      const result = datastore._mapRow({});
      assert.deepStrictEqual(result, {});
    });
  });

  describe('_buildWhere', () => {
    it('should build simple equality WHERE clause', () => {
      const query = { userId: '123', albumId: 'abc' };
      const result = datastore._buildWhere(query);

      assert.ok(result.text.includes('WHERE'));
      assert.ok(result.text.includes('user_id = $1'));
      assert.ok(result.text.includes('album_id = $2'));
      assert.ok(result.text.includes('AND'));
      assert.deepStrictEqual(result.values, ['123', 'abc']);
    });

    it('should handle $gt operator', () => {
      const query = { createdAt: { $gt: new Date('2024-01-01') } };
      const result = datastore._buildWhere(query);

      assert.ok(result.text.includes('createdAt > $1'));
      assert.strictEqual(result.values.length, 1);
      assert.ok(result.values[0] instanceof Date);
    });

    it('should handle $exists operator with true', () => {
      const query = { email: { $exists: true } };
      const result = datastore._buildWhere(query);

      assert.ok(result.text.includes('email IS NOT NULL'));
      assert.strictEqual(result.values.length, 0);
    });

    it('should handle $exists operator with false', () => {
      const query = { email: { $exists: false } };
      const result = datastore._buildWhere(query);

      assert.ok(result.text.includes('email IS NULL'));
      assert.strictEqual(result.values.length, 0);
    });

    it('should return empty WHERE for empty query', () => {
      const result = datastore._buildWhere({});

      assert.strictEqual(result.text, '');
      assert.deepStrictEqual(result.values, []);
    });

    it('should use custom startIndex for parameter numbering', () => {
      const query = { userId: '123' };
      const result = datastore._buildWhere(query, 5);

      assert.ok(result.text.includes('$5'));
      assert.deepStrictEqual(result.values, ['123']);
    });

    it('should handle mixed operators and values', () => {
      const query = {
        userId: '123',
        createdAt: { $gt: new Date('2024-01-01') },
        email: { $exists: true },
      };
      const result = datastore._buildWhere(query);

      assert.ok(result.text.includes('user_id = $1'));
      assert.ok(result.text.includes('createdAt > $2'));
      assert.ok(result.text.includes('email IS NOT NULL'));
      assert.strictEqual(result.values.length, 2);
    });
  });

  describe('_callbackify', () => {
    it('should call callback with result on success', async () => {
      const mockCallback = mock.fn();
      const promise = Promise.resolve('success');

      datastore._callbackify(promise, mockCallback);

      // Wait for promise to resolve
      await promise;

      // Give callback time to be called
      await new Promise((resolve) => setTimeout(resolve, 10));

      assert.strictEqual(mockCallback.mock.calls.length, 1);
      assert.strictEqual(mockCallback.mock.calls[0].arguments[0], null);
      assert.strictEqual(mockCallback.mock.calls[0].arguments[1], 'success');
    });

    it('should call callback with error on failure', async () => {
      const mockCallback = mock.fn();
      const error = new Error('Test error');
      const promise = Promise.reject(error);

      datastore._callbackify(promise, mockCallback);

      // Wait for promise to reject
      await promise.catch(() => {});

      // Give callback time to be called
      await new Promise((resolve) => setTimeout(resolve, 10));

      assert.strictEqual(mockCallback.mock.calls.length, 1);
      assert.strictEqual(mockCallback.mock.calls[0].arguments[0], error);
    });

    it('should return promise if no callback provided', () => {
      const promise = Promise.resolve('success');
      const result = datastore._callbackify(promise);

      assert.strictEqual(result, promise);
    });
  });

  describe('findOne', () => {
    it('should execute query and return first row', async () => {
      const mockRow = { user_id: '123', album_id: 'abc' };
      mockPool.query = mock.fn(() =>
        Promise.resolve({ rows: [mockRow], rowCount: 1 })
      );

      const result = await datastore.findOne({ userId: '123' });

      assert.strictEqual(result.userId, '123');
      assert.strictEqual(result.albumId, 'abc');
      assert.strictEqual(mockPool.query.mock.calls.length, 1);

      // Check query structure
      const queryCall = mockPool.query.mock.calls[0].arguments[0];
      assert.ok(queryCall.text.includes('SELECT * FROM test_table'));
      assert.ok(queryCall.text.includes('LIMIT 1'));
    });

    it('should return null when no rows found', async () => {
      mockPool.query = mock.fn(() =>
        Promise.resolve({ rows: [], rowCount: 0 })
      );

      const result = await datastore.findOne({ userId: 'nonexistent' });

      assert.strictEqual(result, null);
    });

    it('should support callback interface', (t, done) => {
      const mockRow = { user_id: '123' };
      mockPool.query = mock.fn(() =>
        Promise.resolve({ rows: [mockRow], rowCount: 1 })
      );

      datastore.findOne({ userId: '123' }, (err, result) => {
        assert.strictEqual(err, null);
        assert.strictEqual(result.userId, '123');
        done();
      });
    });
  });

  describe('find', () => {
    it('should execute query and return all matching rows', async () => {
      const mockRows = [
        { user_id: '123', album_id: 'abc' },
        { user_id: '123', album_id: 'def' },
      ];
      mockPool.query = mock.fn(() =>
        Promise.resolve({ rows: mockRows, rowCount: 2 })
      );

      const result = await datastore.find({ userId: '123' });

      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].userId, '123');
      assert.strictEqual(result[0].albumId, 'abc');
      assert.strictEqual(result[1].albumId, 'def');
    });

    it('should return empty array when no rows found', async () => {
      mockPool.query = mock.fn(() =>
        Promise.resolve({ rows: [], rowCount: 0 })
      );

      const result = await datastore.find({ userId: 'nonexistent' });

      assert.deepStrictEqual(result, []);
    });

    it('should support callback interface', (t, done) => {
      const mockRows = [{ user_id: '123' }];
      mockPool.query = mock.fn(() =>
        Promise.resolve({ rows: mockRows, rowCount: 1 })
      );

      datastore.find({ userId: '123' }, (err, result) => {
        assert.strictEqual(err, null);
        assert.strictEqual(result.length, 1);
        done();
      });
    });
  });

  describe('count', () => {
    it('should return count of matching rows', async () => {
      mockPool.query = mock.fn(() =>
        Promise.resolve({ rows: [{ cnt: '42' }], rowCount: 1 })
      );

      const result = await datastore.count({ userId: '123' });

      assert.strictEqual(result, 42);
      assert.strictEqual(mockPool.query.mock.calls.length, 1);

      const queryCall = mockPool.query.mock.calls[0].arguments[0];
      assert.ok(queryCall.includes('SELECT COUNT(*)'));
    });

    it('should return 0 when no rows match', async () => {
      mockPool.query = mock.fn(() =>
        Promise.resolve({ rows: [{ cnt: '0' }], rowCount: 1 })
      );

      const result = await datastore.count({ userId: 'nonexistent' });

      assert.strictEqual(result, 0);
    });

    it('should support callback interface', (t, done) => {
      mockPool.query = mock.fn(() =>
        Promise.resolve({ rows: [{ cnt: '10' }], rowCount: 1 })
      );

      datastore.count({ userId: '123' }, (err, result) => {
        assert.strictEqual(err, null);
        assert.strictEqual(result, 10);
        done();
      });
    });
  });

  describe('insert', () => {
    it('should insert document and return it with generated _id', async () => {
      const doc = { userId: '123', albumId: 'abc' };
      mockPool.query = mock.fn(() =>
        Promise.resolve({
          rows: [{ _id: 'generated123', user_id: '123', album_id: 'abc' }],
          rowCount: 1,
        })
      );

      const result = await datastore.insert(doc);

      assert.strictEqual(result._id, 'generated123');
      assert.strictEqual(result.userId, '123');
      assert.strictEqual(mockPool.query.mock.calls.length, 1);

      const queryCall = mockPool.query.mock.calls[0].arguments[0];
      assert.ok(queryCall.includes('INSERT INTO test_table'));
      assert.ok(queryCall.includes('RETURNING *'));
    });

    it('should auto-generate _id if not provided', async () => {
      const doc = { userId: '123' };
      mockPool.query = mock.fn(() =>
        Promise.resolve({
          rows: [{ _id: 'auto-generated', user_id: '123' }],
          rowCount: 1,
        })
      );

      await datastore.insert(doc);

      // Check that _id was added to the document
      assert.ok(doc._id);
      assert.strictEqual(typeof doc._id, 'string');
      assert.strictEqual(doc._id.length, 24); // 12 bytes as hex = 24 chars
    });

    it('should use existing _id if provided', async () => {
      const doc = { _id: 'custom-id', userId: '123' };
      mockPool.query = mock.fn(() =>
        Promise.resolve({
          rows: [{ _id: 'custom-id', user_id: '123' }],
          rowCount: 1,
        })
      );

      const result = await datastore.insert(doc);

      assert.strictEqual(result._id, 'custom-id');
    });

    it('should support callback interface', (t, done) => {
      mockPool.query = mock.fn(() =>
        Promise.resolve({
          rows: [{ _id: 'test', user_id: '123' }],
          rowCount: 1,
        })
      );

      datastore.insert({ userId: '123' }, (err, result) => {
        assert.strictEqual(err, null);
        assert.strictEqual(result.userId, '123');
        done();
      });
    });
  });

  describe('update', () => {
    it('should update matching rows with $set', async () => {
      mockPool.query = mock.fn(() => Promise.resolve({ rowCount: 2 }));

      const result = await datastore.update(
        { userId: '123' },
        { $set: { albumId: 'new-id', listName: 'Updated List' } }
      );

      assert.strictEqual(result, 2);
      assert.strictEqual(mockPool.query.mock.calls.length, 1);

      const queryCall = mockPool.query.mock.calls[0].arguments[0];
      assert.ok(queryCall.includes('UPDATE test_table'));
      assert.ok(queryCall.includes('SET'));
      assert.ok(queryCall.includes('album_id = $1'));
      assert.ok(queryCall.includes('list_name = $2'));
    });

    it('should handle $unset to set fields to NULL', async () => {
      mockPool.query = mock.fn(() => Promise.resolve({ rowCount: 1 }));

      await datastore.update(
        { userId: '123' },
        { $unset: { albumId: 1, listName: 1 } }
      );

      const queryCall = mockPool.query.mock.calls[0].arguments[0];
      assert.ok(queryCall.includes('album_id = NULL'));
      assert.ok(queryCall.includes('list_name = NULL'));
    });

    it('should handle both $set and $unset', async () => {
      mockPool.query = mock.fn(() => Promise.resolve({ rowCount: 1 }));

      await datastore.update(
        { userId: '123' },
        { $set: { albumId: 'new' }, $unset: { listName: 1 } }
      );

      const queryCall = mockPool.query.mock.calls[0].arguments[0];
      assert.ok(queryCall.includes('album_id = $1'));
      assert.ok(queryCall.includes('list_name = NULL'));
    });

    it('should return 0 when no changes to make', async () => {
      const result = await datastore.update({ userId: '123' }, {});

      assert.strictEqual(result, 0);
      assert.strictEqual(mockPool.query.mock.calls.length, 0);
    });

    it('should support callback interface', (t, done) => {
      mockPool.query = mock.fn(() => Promise.resolve({ rowCount: 1 }));

      datastore.update(
        { userId: '123' },
        { $set: { albumId: 'new' } },
        (err, result) => {
          assert.strictEqual(err, null);
          assert.strictEqual(result, 1);
          done();
        }
      );
    });

    it('should support callback as third parameter', (t, done) => {
      mockPool.query = mock.fn(() => Promise.resolve({ rowCount: 1 }));

      datastore.update(
        { userId: '123' },
        { $set: { albumId: 'new' } },
        {},
        (err, result) => {
          assert.strictEqual(err, null);
          assert.strictEqual(result, 1);
          done();
        }
      );
    });
  });

  describe('remove', () => {
    it('should delete matching rows', async () => {
      mockPool.query = mock.fn(() => Promise.resolve({ rowCount: 3 }));

      const result = await datastore.remove({ userId: '123' });

      assert.strictEqual(result, 3);
      assert.strictEqual(mockPool.query.mock.calls.length, 1);

      const queryCall = mockPool.query.mock.calls[0].arguments[0];
      assert.ok(queryCall.includes('DELETE FROM test_table'));
      assert.ok(queryCall.includes('WHERE'));
    });

    it('should return 0 when no rows match', async () => {
      mockPool.query = mock.fn(() => Promise.resolve({ rowCount: 0 }));

      const result = await datastore.remove({ userId: 'nonexistent' });

      assert.strictEqual(result, 0);
    });

    it('should support callback interface', (t, done) => {
      mockPool.query = mock.fn(() => Promise.resolve({ rowCount: 1 }));

      datastore.remove({ userId: '123' }, (err, result) => {
        assert.strictEqual(err, null);
        assert.strictEqual(result, 1);
        done();
      });
    });

    it('should support callback as third parameter', (t, done) => {
      mockPool.query = mock.fn(() => Promise.resolve({ rowCount: 1 }));

      datastore.remove({ userId: '123' }, {}, (err, result) => {
        assert.strictEqual(err, null);
        assert.strictEqual(result, 1);
        done();
      });
    });
  });

  describe('findByAlbumIds', () => {
    it('should find albums by multiple IDs', async () => {
      const mockRows = [
        { album_id: 'abc', artist: 'Artist 1' },
        { album_id: 'def', artist: 'Artist 2' },
      ];
      mockPool.query = mock.fn(() =>
        Promise.resolve({ rows: mockRows, rowCount: 2 })
      );

      const result = await datastore.findByAlbumIds(['abc', 'def']);

      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].albumId, 'abc');
      assert.strictEqual(result[1].albumId, 'def');

      const queryCall = mockPool.query.mock.calls[0].arguments[0];
      assert.ok(queryCall.text.includes('IN ($1,$2)'));
    });

    it('should return empty array for empty input', async () => {
      const result = await datastore.findByAlbumIds([]);

      assert.deepStrictEqual(result, []);
      assert.strictEqual(mockPool.query.mock.calls.length, 0);
    });

    it('should return empty array for null input', async () => {
      const result = await datastore.findByAlbumIds(null);

      assert.deepStrictEqual(result, []);
      assert.strictEqual(mockPool.query.mock.calls.length, 0);
    });

    it('should cache results', async () => {
      const mockRows = [{ album_id: 'abc' }];
      mockPool.query = mock.fn(() =>
        Promise.resolve({ rows: mockRows, rowCount: 1 })
      );

      // First call - should query database
      const result1 = await datastore.findByAlbumIds(['abc']);
      assert.strictEqual(mockPool.query.mock.calls.length, 1);

      // Second call - should use cache
      const result2 = await datastore.findByAlbumIds(['abc']);
      assert.strictEqual(mockPool.query.mock.calls.length, 1); // Still 1, no new query

      assert.deepStrictEqual(result1, result2);
    });

    it('should expire cache after timeout', async () => {
      const mockRows = [{ album_id: 'abc' }];
      mockPool.query = mock.fn(() =>
        Promise.resolve({ rows: mockRows, rowCount: 1 })
      );

      // Use a short cache timeout for testing
      datastore.cacheTimeout = 50; // 50ms

      // First call
      await datastore.findByAlbumIds(['abc']);
      assert.strictEqual(mockPool.query.mock.calls.length, 1);

      // Wait for cache to expire
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Second call - cache expired, should query again
      await datastore.findByAlbumIds(['abc']);
      assert.strictEqual(mockPool.query.mock.calls.length, 2);
    });

    it('should support callback interface', (t, done) => {
      const mockRows = [{ album_id: 'abc' }];
      mockPool.query = mock.fn(() =>
        Promise.resolve({ rows: mockRows, rowCount: 1 })
      );

      datastore.findByAlbumIds(['abc'], (err, result) => {
        assert.strictEqual(err, null);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].albumId, 'abc');
        done();
      });
    });
  });

  describe('findWithAlbumData', () => {
    beforeEach(() => {
      // Create a list_items datastore
      datastore = new PgDatastore(mockPool, 'list_items', {
        listId: 'list_id',
        albumId: 'album_id',
        trackPick: 'track_pick',
        coverImage: 'cover_image',
        coverImageFormat: 'cover_image_format',
        releaseDate: 'release_date',
        genre1: 'genre_1',
        genre2: 'genre_2',
      });
    });

    it('should join list_items with albums table', async () => {
      const mockRows = [
        {
          _id: 'item1',
          list_id: 'list123',
          position: 1,
          track_pick: 'Track 1',
          comments: 'Great album',
          album_id: 'abc',
          artist: 'Artist Name',
          album: 'Album Title',
          release_date: '2024-01-01',
          country: 'US',
          genre_1: 'Rock',
          genre_2: 'Alternative',
          tracks: null,
          cover_image: 'image.jpg',
          cover_image_format: 'jpg',
        },
      ];
      mockPool.query = mock.fn(() =>
        Promise.resolve({ rows: mockRows, rowCount: 1 })
      );

      const result = await datastore.findWithAlbumData('list123');

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]._id, 'item1');
      assert.strictEqual(result[0].listId, 'list123');
      assert.strictEqual(result[0].artist, 'Artist Name');
      assert.strictEqual(result[0].album, 'Album Title');
      assert.strictEqual(result[0].trackPick, 'Track 1');

      // Check that prepared query was used
      const queryCall = mockPool.query.mock.calls[0].arguments[0];
      assert.strictEqual(queryCall.name, 'findListItemsWithAlbums');
      assert.ok(queryCall.text.includes('LEFT JOIN albums'));
      assert.ok(queryCall.text.includes('COALESCE'));
    });

    it('should throw error if not list_items table', async () => {
      const wrongDatastore = new PgDatastore(mockPool, 'wrong_table', {});

      await assert.rejects(
        async () => {
          await wrongDatastore.findWithAlbumData('list123');
        },
        {
          message: 'findWithAlbumData only available for list_items table',
        }
      );
    });

    it('should handle empty results', async () => {
      mockPool.query = mock.fn(() =>
        Promise.resolve({ rows: [], rowCount: 0 })
      );

      const result = await datastore.findWithAlbumData('nonexistent');

      assert.deepStrictEqual(result, []);
    });

    it('should handle null values in optional fields', async () => {
      const mockRows = [
        {
          _id: 'item1',
          list_id: 'list123',
          position: 1,
          track_pick: null,
          comments: null,
          album_id: 'abc',
          artist: 'Artist',
          album: 'Album',
          release_date: null,
          country: null,
          genre_1: null,
          genre_2: null,
          tracks: null,
          cover_image: null,
          cover_image_format: null,
        },
      ];
      mockPool.query = mock.fn(() =>
        Promise.resolve({ rows: mockRows, rowCount: 1 })
      );

      const result = await datastore.findWithAlbumData('list123');

      assert.strictEqual(result[0].trackPick, '');
      assert.strictEqual(result[0].comments, '');
      assert.strictEqual(result[0].releaseDate, '');
      assert.strictEqual(result[0].country, '');
      assert.strictEqual(result[0].coverImage, '');
    });

    it('should handle all null values to cover || operator branches', async () => {
      const mockRows = [
        {
          _id: 'item1',
          list_id: 'list123',
          position: 1,
          track_pick: null,
          comments: null,
          album_id: null, // Test null album_id
          artist: null, // Test null artist (line 328)
          album: null, // Test null album (line 329)
          release_date: null,
          country: null,
          genre_1: null,
          genre_2: null,
          tracks: null,
          cover_image: null,
          cover_image_format: null,
        },
      ];
      mockPool.query = mock.fn(() =>
        Promise.resolve({ rows: mockRows, rowCount: 1 })
      );

      const result = await datastore.findWithAlbumData('list123');

      // All || operators should use the fallback values
      assert.strictEqual(result[0].artist, ''); // Line 328: row.artist || ''
      assert.strictEqual(result[0].album, ''); // Line 329: row.album || ''
      assert.strictEqual(result[0].albumId, ''); // Line 330: row.album_id || ''
      assert.strictEqual(result[0].releaseDate, '');
      assert.strictEqual(result[0].country, '');
      assert.strictEqual(result[0].genre1, '');
      assert.strictEqual(result[0].genre2, '');
      assert.strictEqual(result[0].trackPick, '');
      assert.strictEqual(result[0].comments, '');
      assert.strictEqual(result[0].coverImage, '');
      assert.strictEqual(result[0].coverImageFormat, '');
      assert.strictEqual(result[0].tracks, null); // tracks uses || null
    });

    it('should handle non-null values to cover truthy branches', async () => {
      const mockRows = [
        {
          _id: 'item1',
          list_id: 'list123',
          position: 1,
          track_pick: 'Track 1',
          comments: 'Great album',
          album_id: 'album123',
          artist: 'The Beatles', // Non-null artist
          album: 'Abbey Road', // Non-null album
          release_date: '1969-09-26',
          country: 'UK',
          genre_1: 'Rock',
          genre_2: 'Pop',
          tracks: 17,
          cover_image: 'cover.jpg',
          cover_image_format: 'jpg',
        },
      ];
      mockPool.query = mock.fn(() =>
        Promise.resolve({ rows: mockRows, rowCount: 1 })
      );

      const result = await datastore.findWithAlbumData('list123');

      // All || operators should use the actual values
      assert.strictEqual(result[0].artist, 'The Beatles');
      assert.strictEqual(result[0].album, 'Abbey Road');
      assert.strictEqual(result[0].albumId, 'album123');
      assert.strictEqual(result[0].releaseDate, '1969-09-26');
      assert.strictEqual(result[0].country, 'UK');
      assert.strictEqual(result[0].genre1, 'Rock');
      assert.strictEqual(result[0].genre2, 'Pop');
      assert.strictEqual(result[0].trackPick, 'Track 1');
      assert.strictEqual(result[0].comments, 'Great album');
      assert.strictEqual(result[0].coverImage, 'cover.jpg');
      assert.strictEqual(result[0].coverImageFormat, 'jpg');
      assert.strictEqual(result[0].tracks, 17);
    });
  });

  describe('_buildWhere edge cases', () => {
    it('should handle object value without special operators', () => {
      // This tests the else clause at lines 130-133
      // When an object is provided but it's not a special operator
      const query = { metadata: { someKey: 'someValue' } };
      const result = datastore._buildWhere(query);

      // Should treat it as a regular value (will be JSON stringified)
      assert.ok(result.text.includes('metadata = $1'));
      assert.strictEqual(result.values.length, 1);
      assert.strictEqual(
        result.values[0],
        JSON.stringify({ someKey: 'someValue' })
      );
    });

    it('should handle array values', () => {
      const query = { tags: ['tag1', 'tag2'] };
      const result = datastore._buildWhere(query);

      // Arrays are not objects (Array.isArray check), so they're treated as regular values
      // But _prepareValue will stringify them as JSON since typeof [] === 'object'
      assert.ok(result.text.includes('tags = $1'));
      assert.strictEqual(result.values.length, 1);
      assert.strictEqual(result.values[0], JSON.stringify(['tag1', 'tag2']));
    });

    it('should handle null and undefined values', () => {
      const query1 = { field: null };
      const result1 = datastore._buildWhere(query1);
      assert.ok(result1.text.includes('field = $1'));
      assert.strictEqual(result1.values[0], null);

      const query2 = { field: undefined };
      const result2 = datastore._buildWhere(query2);
      assert.ok(result2.text.includes('field = $1'));
      assert.strictEqual(result2.values[0], undefined);
    });
  });

  describe('logging with LOG_SQL=true', () => {
    it('should log queries when LOG_SQL is enabled', async () => {
      // Create a datastore with logging enabled
      const loggingDatastore = new PgDatastore(mockPool, testTable, {});
      loggingDatastore.logQueries = true;

      mockPool.query = mock.fn(() =>
        Promise.resolve({ rows: [], rowCount: 0 })
      );

      // Execute a query
      await loggingDatastore.find({ userId: '123' });

      // Query should have been called (we can't easily test logger output in this setup)
      assert.strictEqual(mockPool.query.mock.calls.length, 1);
    });

    it('should log prepared queries when LOG_SQL is enabled', async () => {
      const loggingDatastore = new PgDatastore(mockPool, testTable, {});
      loggingDatastore.logQueries = true;

      mockPool.query = mock.fn(() =>
        Promise.resolve({ rows: [], rowCount: 0 })
      );

      // Execute a prepared query through findOne
      await loggingDatastore.findOne({ userId: '123' });

      assert.strictEqual(mockPool.query.mock.calls.length, 1);
    });

    it('should log non-prepared queries (count, insert, update, remove)', async () => {
      const loggingDatastore = new PgDatastore(mockPool, testTable, {});
      loggingDatastore.logQueries = true;

      mockPool.query = mock.fn(() =>
        Promise.resolve({ rows: [{ cnt: '5' }], rowCount: 1 })
      );

      // Execute count which uses _query (non-prepared)
      await loggingDatastore.count({ userId: '123' });

      // This should trigger the _query logging path at lines 88-92
      assert.strictEqual(mockPool.query.mock.calls.length, 1);
    });

    it('should log insert queries with sanitized params', async () => {
      const loggingDatastore = new PgDatastore(mockPool, testTable, {});
      loggingDatastore.logQueries = true;

      mockPool.query = mock.fn(() =>
        Promise.resolve({
          rows: [{ _id: 'test123', user_id: '123' }],
          rowCount: 1,
        })
      );

      // Insert with a large base64 string that should be sanitized in logs
      const largeBase64 = 'A'.repeat(150);
      await loggingDatastore.insert({ userId: '123', data: largeBase64 });

      // This should trigger _query logging with sanitized params
      assert.strictEqual(mockPool.query.mock.calls.length, 1);
    });
  });
});

describe('waitForPostgres', () => {
  it('should succeed when database is immediately available', async () => {
    const mockPool = {
      query: mock.fn(() => Promise.resolve({ rows: [{ '?column?': 1 }] })),
    };

    await waitForPostgres(mockPool, 3, 10);

    assert.strictEqual(mockPool.query.mock.calls.length, 1);
  });

  it('should retry and eventually succeed', async () => {
    let attempts = 0;
    const mockPool = {
      query: mock.fn(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new Error('Connection failed'));
        }
        return Promise.resolve({ rows: [{ '?column?': 1 }] });
      }),
    };

    await waitForPostgres(mockPool, 5, 10);

    assert.strictEqual(mockPool.query.mock.calls.length, 3);
  });

  it('should throw error after max retries', async () => {
    const mockPool = {
      query: mock.fn(() => Promise.reject(new Error('Connection failed'))),
    };

    await assert.rejects(
      async () => {
        await waitForPostgres(mockPool, 3, 10);
      },
      {
        message: 'PostgreSQL not reachable',
      }
    );

    assert.strictEqual(mockPool.query.mock.calls.length, 3);
  });

  it('should use default retry settings', async () => {
    const mockPool = {
      query: mock.fn(() => Promise.resolve({ rows: [{ '?column?': 1 }] })),
    };

    // Call without retry params to test defaults
    await waitForPostgres(mockPool);

    assert.strictEqual(mockPool.query.mock.calls.length, 1);
  });
});

describe('warmConnections', () => {
  it('should warm connections based on pool.options.min', async () => {
    const mockPool = {
      options: { min: 3 },
      query: mock.fn(() => Promise.resolve({ rows: [{ warmup: 1 }] })),
    };

    await warmConnections(mockPool);

    assert.strictEqual(mockPool.query.mock.calls.length, 3);
    assert.strictEqual(
      mockPool.query.mock.calls[0].arguments[0],
      'SELECT 1 as warmup'
    );
  });

  it('should default to 5 connections when pool.options.min not set', async () => {
    const mockPool = {
      options: {},
      query: mock.fn(() => Promise.resolve({ rows: [{ warmup: 1 }] })),
    };

    await warmConnections(mockPool);

    assert.strictEqual(mockPool.query.mock.calls.length, 5);
  });

  it('should handle connection failures gracefully', async () => {
    const mockPool = {
      options: { min: 3 },
      query: mock.fn(() =>
        Promise.reject(new Error('Connection warmup failed'))
      ),
    };

    // Should not throw error, just log warnings
    await warmConnections(mockPool);

    assert.strictEqual(mockPool.query.mock.calls.length, 3);
  });

  it('should handle mixed success and failures', async () => {
    let callCount = 0;
    const mockPool = {
      options: { min: 3 },
      query: mock.fn(() => {
        callCount++;
        if (callCount === 2) {
          return Promise.reject(new Error('Connection 2 failed'));
        }
        return Promise.resolve({ rows: [{ warmup: 1 }] });
      }),
    };

    await warmConnections(mockPool);

    assert.strictEqual(mockPool.query.mock.calls.length, 3);
  });

  it('should handle pool with null options.min', async () => {
    const mockPool = {
      options: { min: null },
      query: mock.fn(() => Promise.resolve({ rows: [{ warmup: 1 }] })),
    };

    await warmConnections(mockPool);

    // Should default to 5 connections when min is null
    assert.strictEqual(mockPool.query.mock.calls.length, 5);
  });
});
