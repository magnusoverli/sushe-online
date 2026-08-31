const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const {
  createCommunityListService,
} = require('../services/community-list-service');

describe('community-list-service', () => {
  it('returns explicit visibility status for every requested year', async () => {
    const raw = mock.fn(async () => ({
      rows: [
        {
          year: 2024,
          revealed: true,
          revealed_at: '2025-01-01T00:00:00.000Z',
          revealed_by: 'admin-1',
          updated_at: '2025-01-01T00:00:00.000Z',
        },
      ],
    }));
    const service = createCommunityListService({ db: { raw } });

    const result = await service.getVisibilityForYears([2024, 2023]);

    assert.strictEqual(result.get(2024).revealed, true);
    assert.deepStrictEqual(result.get(2023), {
      year: 2023,
      revealed: false,
      revealedAt: null,
      revealedBy: null,
      updatedAt: null,
    });
  });

  it('toggles only independent visibility and records the admin for reveals', async () => {
    const raw = mock.fn(async (sql, params) => ({
      rows: [
        {
          year: params[0],
          revealed: params[1],
          revealed_at: params[1] ? '2025-01-01T00:00:00.000Z' : null,
          revealed_by: params[1] ? params[2] : null,
          updated_at: '2025-01-01T00:00:00.000Z',
        },
      ],
    }));
    const service = createCommunityListService({ db: { raw } });

    const visible = await service.setYearVisibility(2024, true, 'admin-1');
    const hidden = await service.setYearVisibility(2024, false, 'admin-1');

    assert.strictEqual(visible.revealedBy, 'admin-1');
    assert.strictEqual(hidden.revealed, false);
    for (const call of raw.mock.calls) {
      const [sql, params] = call.arguments;
      assert.match(sql, /user_list_year_visibility/);
      assert.doesNotMatch(sql, /master_lists/);
      assert.deepStrictEqual(params, [
        2024,
        call === raw.mock.calls[0],
        'admin-1',
      ]);
    }
  });

  it('lists approved users main lists for revealed years without contributor filtering', async () => {
    const raw = mock.fn(async () => ({
      rows: [
        {
          list_id: 'list-1',
          name: 'Best of 2024',
          year: 2024,
          username: 'alice',
          item_count: 3,
          updated_at: '2025-01-01T00:00:00.000Z',
        },
      ],
    }));
    const service = createCommunityListService({ db: { raw } });

    const result = await service.getMainListSummaries('viewer-1');
    const [sql, params] = raw.mock.calls[0].arguments;

    assert.deepStrictEqual(params, ['viewer-1']);
    assert.match(sql, /JOIN user_list_year_visibility/);
    assert.match(sql, /visibility\.revealed = TRUE/);
    assert.match(sql, /l\.is_main = TRUE/);
    assert.match(sql, /l\.user_id <> \$1/);
    assert.match(sql, /u\.approval_status = 'approved'/);
    assert.match(sql, /ORDER BY u\.username ASC, l\.year DESC/);
    assert.doesNotMatch(
      sql,
      /aggregate_list_contributors|master_lists|COALESCE/
    );
    assert.deepStrictEqual(result, [
      {
        id: 'list-1',
        name: 'Best of 2024',
        year: 2024,
        owner: { username: 'alice' },
        itemCount: 3,
      },
    ]);
  });

  it('returns ordered complete items, including disqualified items, in a private-safe DTO', async () => {
    const rows = [
      {
        list_id: 'list-1',
        name: 'Best of 2024',
        year: 2024,
        username: 'alice',
        updated_at: '2025-01-01T00:00:00.000Z',
        position: 1,
        album_id: 'album-1',
        artist: 'Artist',
        album: 'Album',
        release_date: '2024',
        country: 'NO',
        genre_1: 'Metal',
        genre_2: 'Ambient',
        cover_image_format: 'image/jpeg',
        cover_image_updated_at: '2025-01-02T00:00:00.000Z',
        cover_thumbnail_updated_at: '2025-01-03T00:00:00.000Z',
        is_disqualified: true,
        disqualification_reason: 'Ineligible release date',
        item_id: 'private-item-id',
        comments: 'private',
        primary_track: 'private',
        summary: 'private',
        recommended_by: 'private',
        email: 'private@example.com',
        user_id: 'private-owner-id',
        album_taxonomy: { private: true },
      },
    ];
    const raw = mock.fn(async () => ({ rows }));
    const coverImageUrl = mock.fn((albumId, _updatedAt, options = {}) =>
      options.size ? `/covers/${albumId}/thumb` : `/covers/${albumId}`
    );
    const service = createCommunityListService({
      db: { raw },
      coverImageUrl,
    });

    const result = await service.getMainListDetail('list-1', 'viewer-1');
    const [sql, params] = raw.mock.calls[0].arguments;

    assert.deepStrictEqual(params, ['list-1', 'viewer-1']);
    assert.strictEqual((sql.match(/WITH\s+/g) || []).length, 1);
    assert.match(sql, /JOIN visibility ON visibility\.year = l\.year/);
    assert.match(sql, /l\.user_id <> \$2/);
    assert.match(sql, /l\.is_main = TRUE/);
    assert.match(sql, /u\.approval_status = 'approved'/);
    assert.match(sql, /ORDER BY li\.position ASC NULLS LAST/);
    assert.doesNotMatch(sql, /is_disqualified\s*=\s*FALSE/);
    assert.doesNotMatch(
      sql,
      /li\.comments|primary_track|secondary_track|summary|recommend|u\.email|l\.user_id AS/
    );
    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.items[0].isDisqualified, true);
    assert.strictEqual(
      result.items[0].disqualificationReason,
      'Ineligible release date'
    );
    assert.strictEqual(result.items[0].coverImageUrl, '/covers/album-1');
    assert.strictEqual(
      result.items[0].coverThumbnailUrl,
      '/covers/album-1/thumb'
    );
    for (const privateField of [
      '_id',
      'item_id',
      'comments',
      'primary_track',
      'secondary_track',
      'summary',
      'recommended_by',
      'email',
      'user_id',
      'taxonomy',
      'taxonomyUpdatedAt',
    ]) {
      assert.strictEqual(Object.hasOwn(result.items[0], privateField), false);
    }
    assert.strictEqual(Object.hasOwn(result, 'userId'), false);
    assert.strictEqual(Object.hasOwn(result, 'email'), false);
    assert.deepStrictEqual(result.owner, { username: 'alice' });
  });

  it('returns null whenever the visibility query returns no eligible list', async () => {
    const service = createCommunityListService({
      db: { raw: mock.fn(async () => ({ rows: [] })) },
    });

    assert.strictEqual(
      await service.getMainListDetail('invisible-list', 'viewer-1'),
      null
    );
  });
});
