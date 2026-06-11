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

  require('../routes/api/bootstrap')(app, {
    ensureAuthAPI: (req, _res, next) => {
      req.user = { _id: 'user-1' };
      next();
    },
    logger,
    cacheConfigs: { userSpecific: (_req, _res, next) => next() },
    listService,
    groupService,
    recommendationService,
  });

  return { app, logger, listService, groupService, recommendationService };
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
    assert.strictEqual(listService.getListById.mock.calls.length, 0);
    assert.strictEqual(logger.warn.mock.calls.length, 1);
  });
});
