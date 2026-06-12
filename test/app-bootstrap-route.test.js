const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');

function createTestApp(overrides = {}) {
  const app = express();
  const logger = {
    warn: mock.fn(),
    error: mock.fn(),
  };
  const listService = {
    getAllLists:
      overrides.getAllLists ||
      mock.fn(async () => ({
        'list-1': {
          _id: 'list-1',
          name: 'List 1',
          count: 1,
        },
      })),
    getListById:
      overrides.getListById ||
      mock.fn(async () => ({
        list: { _id: 'list-1' },
        items: [{ album_id: 'album-1' }],
      })),
  };
  const groupService = {
    getGroups: overrides.getGroups || mock.fn(async () => [{ _id: 'group-1' }]),
  };
  const recommendationService = {
    getYears: overrides.getYears || mock.fn(async () => [2024]),
  };
  const playcountService = overrides.playcountService || null;
  const user = overrides.user || { _id: 'user-1' };
  const db = {};
  const normalizeAlbumKey = (artist, album) => `${artist}:${album}`;

  require('../routes/api/bootstrap')(app, {
    ensureAuthAPI: (req, _res, next) => {
      req.user = user;
      next();
    },
    logger,
    cacheConfigs: { userSpecific: (_req, _res, next) => next() },
    listService,
    groupService,
    recommendationService,
    playcountService,
    db,
    normalizeAlbumKey,
  });

  return {
    app,
    logger,
    listService,
    groupService,
    recommendationService,
    playcountService,
    db,
    normalizeAlbumKey,
  };
}

describe('app bootstrap route', () => {
  it('returns startup metadata and the selected core list payload', async () => {
    const { app, listService, groupService, recommendationService } =
      createTestApp();

    const response = await request(app)
      .get('/api/app-bootstrap?selectedListId=list-1')
      .expect(200);

    assert.deepStrictEqual(response.body, {
      lists: {
        'list-1': {
          _id: 'list-1',
          name: 'List 1',
          count: 1,
        },
      },
      groups: [{ _id: 'group-1' }],
      recommendationYears: [2024],
      selectedListId: 'list-1',
      selectedListItems: [{ album_id: 'album-1' }],
      selectedListProfile: 'core',
      selectedListPlaycounts: null,
      selectedListPlaycountRefreshing: 0,
    });
    assert.deepStrictEqual(listService.getAllLists.mock.calls[0].arguments, [
      'user-1',
    ]);
    assert.deepStrictEqual(groupService.getGroups.mock.calls[0].arguments, [
      'user-1',
    ]);
    assert.strictEqual(recommendationService.getYears.mock.calls.length, 1);
    assert.deepStrictEqual(listService.getListById.mock.calls[0].arguments, [
      'list-1',
      'user-1',
      { profile: 'core' },
    ]);
  });

  it('continues bootstrap when recommendation years fail', async () => {
    const { app, logger, listService } = createTestApp({
      getYears: mock.fn(async () => {
        throw new Error('recommendations unavailable');
      }),
    });

    const response = await request(app).get('/api/app-bootstrap').expect(200);

    assert.deepStrictEqual(response.body.recommendationYears, []);
    assert.strictEqual(response.body.selectedListId, null);
    assert.strictEqual(response.body.selectedListItems, null);
    assert.strictEqual(response.body.selectedListProfile, null);
    assert.strictEqual(response.body.selectedListPlaycounts, null);
    assert.strictEqual(response.body.selectedListPlaycountRefreshing, 0);
    assert.strictEqual(listService.getListById.mock.calls.length, 0);
    assert.strictEqual(logger.warn.mock.calls.length, 1);
  });

  it('includes cached playcounts for the selected list when Last.fm is connected', async () => {
    const playcountService = {
      getListPlaycounts: mock.fn(async () => ({
        playcounts: {
          'item-1': { playcount: 42, status: 'success' },
        },
        refreshing: 3,
      })),
    };
    const { app, logger, db, normalizeAlbumKey } = createTestApp({
      user: { _id: 'user-1', lastfmUsername: 'listener' },
      getListById: mock.fn(async () => ({
        list: { _id: 'list-1' },
        items: [{ _id: 'item-1', album_id: 'album-1' }],
      })),
      playcountService,
    });

    const response = await request(app)
      .get('/api/app-bootstrap?selectedListId=list-1')
      .expect(200);

    assert.deepStrictEqual(response.body.selectedListPlaycounts, {
      'item-1': { playcount: 42, status: 'success' },
    });
    assert.strictEqual(response.body.selectedListPlaycountRefreshing, 3);
    assert.strictEqual(playcountService.getListPlaycounts.mock.calls.length, 1);
    const args = playcountService.getListPlaycounts.mock.calls[0].arguments[0];
    assert.strictEqual(args.listId, 'list-1');
    assert.strictEqual(args.userId, 'user-1');
    assert.strictEqual(args.lastfmUsername, 'listener');
    assert.strictEqual(args.db, db);
    assert.strictEqual(args.logger, logger);
    assert.strictEqual(args.normalizeAlbumKey, normalizeAlbumKey);
  });
});
