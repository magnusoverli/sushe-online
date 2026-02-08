const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const {
  createAggregateList,
  POSITION_POINTS,
  getPositionPoints,
} = require('../services/aggregate-list.js');

// =============================================================================
// Helper functions
// =============================================================================

function createMockLogger() {
  return {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
}

function createMockPool(queryResults = []) {
  let callIndex = 0;
  return {
    query: mock.fn(async () => {
      const result = queryResults[callIndex] || { rows: [] };
      callIndex++;
      return result;
    }),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('aggregate-list', () => {
  // ===========================================================================
  // POSITION_POINTS tests
  // ===========================================================================

  describe('POSITION_POINTS', () => {
    it('should have correct points for position 1', () => {
      assert.strictEqual(POSITION_POINTS[1], 60);
    });

    it('should have correct points for position 10', () => {
      assert.strictEqual(POSITION_POINTS[10], 32);
    });

    it('should have correct points for position 20', () => {
      assert.strictEqual(POSITION_POINTS[20], 21);
    });

    it('should have correct points for position 40', () => {
      assert.strictEqual(POSITION_POINTS[40], 1);
    });

    it('should have 40 positions defined', () => {
      assert.strictEqual(Object.keys(POSITION_POINTS).length, 40);
    });
  });

  describe('getPositionPoints', () => {
    it('should return correct points for valid positions', () => {
      assert.strictEqual(getPositionPoints(1), 60);
      assert.strictEqual(getPositionPoints(5), 43);
      assert.strictEqual(getPositionPoints(15), 26);
    });

    it('should return 0 for positions beyond 40', () => {
      assert.strictEqual(getPositionPoints(41), 0);
      assert.strictEqual(getPositionPoints(100), 0);
    });

    it('should return 0 for invalid positions', () => {
      assert.strictEqual(getPositionPoints(0), 0);
      assert.strictEqual(getPositionPoints(-1), 0);
    });
  });

  // ===========================================================================
  // createAggregateList factory tests
  // ===========================================================================

  describe('createAggregateList', () => {
    it('should throw if pool is not provided', () => {
      assert.throws(
        () => createAggregateList({}),
        /PostgreSQL pool is required/
      );
    });

    it('should create instance with pool', () => {
      const pool = createMockPool();
      const aggregateList = createAggregateList({ pool });
      assert.ok(aggregateList);
      assert.strictEqual(typeof aggregateList.aggregateForYear, 'function');
      assert.strictEqual(typeof aggregateList.recompute, 'function');
      assert.strictEqual(typeof aggregateList.get, 'function');
      assert.strictEqual(typeof aggregateList.getStatus, 'function');
      assert.strictEqual(typeof aggregateList.addConfirmation, 'function');
      assert.strictEqual(typeof aggregateList.removeConfirmation, 'function');
      assert.strictEqual(typeof aggregateList.getStats, 'function');
      assert.strictEqual(typeof aggregateList.getRevealedYears, 'function');
      // Contributor management functions
      assert.strictEqual(typeof aggregateList.getContributors, 'function');
      assert.strictEqual(typeof aggregateList.getEligibleUsers, 'function');
      assert.strictEqual(typeof aggregateList.addContributor, 'function');
      assert.strictEqual(typeof aggregateList.removeContributor, 'function');
      assert.strictEqual(typeof aggregateList.setContributors, 'function');
    });
  });

  // ===========================================================================
  // aggregateForYear tests
  // ===========================================================================

  describe('aggregateForYear', () => {
    it('should return empty result when no main lists exist', async () => {
      const pool = createMockPool([
        { rows: [] }, // No main lists
      ]);
      const logger = createMockLogger();
      const aggregateList = createAggregateList({ pool, logger });

      const result = await aggregateList.aggregateForYear(2024);

      assert.strictEqual(result.data.year, 2024);
      assert.strictEqual(result.data.participantCount, 0);
      assert.deepStrictEqual(result.data.albums, []);
      assert.strictEqual(result.stats.totalAlbums, 0);
    });

    it('should aggregate albums from multiple main lists', async () => {
      const pool = createMockPool([
        // Main lists query
        {
          rows: [
            { list_id: 'list1', user_id: 'user1', username: 'alice' },
            { list_id: 'list2', user_id: 'user2', username: 'bob' },
          ],
        },
        // List items query
        {
          rows: [
            {
              list_id: 'list1',
              user_id: 'user1',
              position: 1,
              album_id: 'album1',
              artist: 'Artist A',
              album: 'Album A',
              cover_image: 'cover1.jpg',
              release_date: '2024-01-01',
              country: 'US',
              genre_1: 'Rock',
              genre_2: 'Alternative',
            },
            {
              list_id: 'list1',
              user_id: 'user1',
              position: 2,
              album_id: 'album2',
              artist: 'Artist B',
              album: 'Album B',
              cover_image: 'cover2.jpg',
              release_date: '2024-02-01',
              country: 'UK',
              genre_1: 'Pop',
              genre_2: null,
            },
            {
              list_id: 'list2',
              user_id: 'user2',
              position: 1,
              album_id: 'album1', // Same album, ranked #1 by bob too
              artist: 'Artist A',
              album: 'Album A',
              cover_image: 'cover1.jpg',
              release_date: '2024-01-01',
              country: 'US',
              genre_1: 'Rock',
              genre_2: 'Alternative',
            },
          ],
        },
      ]);
      const logger = createMockLogger();
      const aggregateList = createAggregateList({ pool, logger });

      const result = await aggregateList.aggregateForYear(2024);

      assert.strictEqual(result.data.participantCount, 2);
      assert.strictEqual(result.data.albums.length, 2);

      // Album A should be ranked #1 (120 points from two #1 positions)
      const albumA = result.data.albums.find((a) => a.albumId === 'album1');
      assert.strictEqual(albumA.rank, 1);
      assert.strictEqual(albumA.totalPoints, 120); // 60 + 60
      assert.strictEqual(albumA.voterCount, 2);
      assert.strictEqual(albumA.voters.length, 2);

      // Album B should be ranked #2 (54 points from one #2 position)
      const albumB = result.data.albums.find((a) => a.albumId === 'album2');
      assert.strictEqual(albumB.rank, 2);
      assert.strictEqual(albumB.totalPoints, 54);
      assert.strictEqual(albumB.voterCount, 1);
    });

    it('should use highestPosition as tiebreaker when points are equal', async () => {
      const pool = createMockPool([
        {
          rows: [
            { list_id: 'list1', user_id: 'user1', username: 'alice' },
            { list_id: 'list2', user_id: 'user2', username: 'bob' },
            { list_id: 'list3', user_id: 'user3', username: 'carol' },
          ],
        },
        {
          rows: [
            // Album A: positions [1, 20] = 60 + 21 = 81 points, highest = 1
            {
              list_id: 'list1',
              user_id: 'user1',
              position: 1,
              album_id: 'albumA',
              artist: 'Artist A',
              album: 'Album A',
              cover_image: '',
              release_date: '',
              country: '',
              genre_1: '',
              genre_2: '',
            },
            {
              list_id: 'list2',
              user_id: 'user2',
              position: 20,
              album_id: 'albumA',
              artist: 'Artist A',
              album: 'Album A',
              cover_image: '',
              release_date: '',
              country: '',
              genre_1: '',
              genre_2: '',
            },
            // Album B: positions [2, 14] = 54 + 27 = 81 points, highest = 2
            {
              list_id: 'list2',
              user_id: 'user2',
              position: 2,
              album_id: 'albumB',
              artist: 'Artist B',
              album: 'Album B',
              cover_image: '',
              release_date: '',
              country: '',
              genre_1: '',
              genre_2: '',
            },
            {
              list_id: 'list3',
              user_id: 'user3',
              position: 14,
              album_id: 'albumB',
              artist: 'Artist B',
              album: 'Album B',
              cover_image: '',
              release_date: '',
              country: '',
              genre_1: '',
              genre_2: '',
            },
          ],
        },
      ]);
      const logger = createMockLogger();
      const aggregateList = createAggregateList({ pool, logger });

      const result = await aggregateList.aggregateForYear(2024);

      const albumA = result.data.albums.find((a) => a.albumId === 'albumA');
      const albumB = result.data.albums.find((a) => a.albumId === 'albumB');

      // Both albums have 81 points
      assert.strictEqual(albumA.totalPoints, 81); // 60 + 21
      assert.strictEqual(albumB.totalPoints, 81); // 54 + 27
      assert.strictEqual(albumA.highestPosition, 1);
      assert.strictEqual(albumB.highestPosition, 2);

      // Album A ranks higher due to better highest position (1 vs 2)
      assert.strictEqual(albumA.rank, 1);
      assert.strictEqual(albumB.rank, 2);
    });

    it('should calculate average, highest, and lowest positions correctly', async () => {
      const pool = createMockPool([
        {
          rows: [
            { list_id: 'list1', user_id: 'user1', username: 'alice' },
            { list_id: 'list2', user_id: 'user2', username: 'bob' },
            { list_id: 'list3', user_id: 'user3', username: 'carol' },
          ],
        },
        {
          rows: [
            {
              list_id: 'list1',
              user_id: 'user1',
              position: 1,
              album_id: 'album1',
              artist: 'Artist',
              album: 'Album',
              cover_image: '',
              release_date: '',
              country: '',
              genre_1: '',
              genre_2: '',
            },
            {
              list_id: 'list2',
              user_id: 'user2',
              position: 5,
              album_id: 'album1',
              artist: 'Artist',
              album: 'Album',
              cover_image: '',
              release_date: '',
              country: '',
              genre_1: '',
              genre_2: '',
            },
            {
              list_id: 'list3',
              user_id: 'user3',
              position: 9,
              album_id: 'album1',
              artist: 'Artist',
              album: 'Album',
              cover_image: '',
              release_date: '',
              country: '',
              genre_1: '',
              genre_2: '',
            },
          ],
        },
      ]);
      const logger = createMockLogger();
      const aggregateList = createAggregateList({ pool, logger });

      const result = await aggregateList.aggregateForYear(2024);
      const album = result.data.albums[0];

      assert.strictEqual(album.highestPosition, 1);
      assert.strictEqual(album.lowestPosition, 9);
      assert.strictEqual(album.averagePosition, 5); // (1+5+9)/3 = 5
      assert.strictEqual(album.totalPoints, 60 + 43 + 34); // 137
    });

    it('should share ranks for albums with same points and highest position', async () => {
      const pool = createMockPool([
        {
          rows: [
            { list_id: 'list1', user_id: 'user1', username: 'alice' },
            { list_id: 'list2', user_id: 'user2', username: 'bob' },
            { list_id: 'list3', user_id: 'user3', username: 'carol' },
          ],
        },
        {
          rows: [
            // Album A: positions [1, 20] = 60 + 21 = 81 points, highest = 1
            {
              list_id: 'list1',
              user_id: 'user1',
              position: 1,
              album_id: 'albumA',
              artist: 'Artist A',
              album: 'Album A',
              cover_image: '',
              release_date: '',
              country: '',
              genre_1: '',
              genre_2: '',
            },
            {
              list_id: 'list2',
              user_id: 'user2',
              position: 20,
              album_id: 'albumA',
              artist: 'Artist A',
              album: 'Album A',
              cover_image: '',
              release_date: '',
              country: '',
              genre_1: '',
              genre_2: '',
            },
            // Album B: positions [1, 20] = 60 + 21 = 81 points, highest = 1 - TIED with A
            {
              list_id: 'list2',
              user_id: 'user2',
              position: 1,
              album_id: 'albumB',
              artist: 'Artist B',
              album: 'Album B',
              cover_image: '',
              release_date: '',
              country: '',
              genre_1: '',
              genre_2: '',
            },
            {
              list_id: 'list3',
              user_id: 'user3',
              position: 20,
              album_id: 'albumB',
              artist: 'Artist B',
              album: 'Album B',
              cover_image: '',
              release_date: '',
              country: '',
              genre_1: '',
              genre_2: '',
            },
            // Album C: positions [2] = 54 points, highest = 2
            {
              list_id: 'list1',
              user_id: 'user1',
              position: 2,
              album_id: 'albumC',
              artist: 'Artist C',
              album: 'Album C',
              cover_image: '',
              release_date: '',
              country: '',
              genre_1: '',
              genre_2: '',
            },
          ],
        },
      ]);
      const logger = createMockLogger();
      const aggregateList = createAggregateList({ pool, logger });

      const result = await aggregateList.aggregateForYear(2024);

      // Albums A and B should both be rank 1 (tied on points and highest position)
      const albumA = result.data.albums.find((a) => a.albumId === 'albumA');
      const albumB = result.data.albums.find((a) => a.albumId === 'albumB');
      const albumC = result.data.albums.find((a) => a.albumId === 'albumC');

      assert.strictEqual(
        albumA.totalPoints,
        81,
        'Album A should have 81 points'
      );
      assert.strictEqual(
        albumB.totalPoints,
        81,
        'Album B should have 81 points'
      );
      assert.strictEqual(
        albumA.highestPosition,
        1,
        'Album A highest position should be 1'
      );
      assert.strictEqual(
        albumB.highestPosition,
        1,
        'Album B highest position should be 1'
      );

      assert.strictEqual(albumA.rank, 1, 'Album A should be rank 1');
      assert.strictEqual(albumB.rank, 1, 'Album B should be rank 1 (tied)');
      assert.strictEqual(
        albumC.rank,
        3,
        'Album C should be rank 3 (skips rank 2)'
      );
    });

    it('should generate correct anonymous stats', async () => {
      const pool = createMockPool([
        {
          rows: [
            { list_id: 'list1', user_id: 'user1', username: 'alice' },
            { list_id: 'list2', user_id: 'user2', username: 'bob' },
            { list_id: 'list3', user_id: 'user3', username: 'carol' },
          ],
        },
        {
          rows: [
            // Album with 3 voters
            {
              list_id: 'list1',
              user_id: 'user1',
              position: 1,
              album_id: 'a1',
              artist: 'A',
              album: 'A',
              cover_image: '',
              release_date: '',
              country: '',
              genre_1: '',
              genre_2: '',
            },
            {
              list_id: 'list2',
              user_id: 'user2',
              position: 1,
              album_id: 'a1',
              artist: 'A',
              album: 'A',
              cover_image: '',
              release_date: '',
              country: '',
              genre_1: '',
              genre_2: '',
            },
            {
              list_id: 'list3',
              user_id: 'user3',
              position: 1,
              album_id: 'a1',
              artist: 'A',
              album: 'A',
              cover_image: '',
              release_date: '',
              country: '',
              genre_1: '',
              genre_2: '',
            },
            // Album with 2 voters
            {
              list_id: 'list1',
              user_id: 'user1',
              position: 2,
              album_id: 'a2',
              artist: 'B',
              album: 'B',
              cover_image: '',
              release_date: '',
              country: '',
              genre_1: '',
              genre_2: '',
            },
            {
              list_id: 'list2',
              user_id: 'user2',
              position: 2,
              album_id: 'a2',
              artist: 'B',
              album: 'B',
              cover_image: '',
              release_date: '',
              country: '',
              genre_1: '',
              genre_2: '',
            },
            // Album with 1 voter
            {
              list_id: 'list1',
              user_id: 'user1',
              position: 3,
              album_id: 'a3',
              artist: 'C',
              album: 'C',
              cover_image: '',
              release_date: '',
              country: '',
              genre_1: '',
              genre_2: '',
            },
          ],
        },
      ]);
      const logger = createMockLogger();
      const aggregateList = createAggregateList({ pool, logger });

      const result = await aggregateList.aggregateForYear(2024);

      assert.strictEqual(result.stats.participantCount, 3);
      assert.strictEqual(result.stats.totalAlbums, 3);
      assert.strictEqual(result.stats.albumsWith3PlusVoters, 1);
      assert.strictEqual(result.stats.albumsWith2Voters, 1);
      assert.strictEqual(result.stats.albumsWith1Voter, 1);
      assert.ok(Array.isArray(result.stats.topPointsDistribution));
    });

    it('should exclude albums that only appear beyond position 40', async () => {
      const pool = createMockPool([
        {
          rows: [
            { list_id: 'list1', user_id: 'user1', username: 'alice' },
            { list_id: 'list2', user_id: 'user2', username: 'bob' },
          ],
        },
        {
          rows: [
            // Album A: position 10 (should be included)
            {
              list_id: 'list1',
              user_id: 'user1',
              position: 10,
              album_id: 'albumA',
              artist: 'Artist A',
              album: 'Album A',
              cover_image: '',
              release_date: '',
              country: '',
              genre_1: '',
              genre_2: '',
            },
            // Album B: position 40 (should be included)
            {
              list_id: 'list1',
              user_id: 'user1',
              position: 40,
              album_id: 'albumB',
              artist: 'Artist B',
              album: 'Album B',
              cover_image: '',
              release_date: '',
              country: '',
              genre_1: '',
              genre_2: '',
            },
            // Album C: position 41 (should be excluded - beyond top 40)
            {
              list_id: 'list1',
              user_id: 'user1',
              position: 41,
              album_id: 'albumC',
              artist: 'Artist C',
              album: 'Album C',
              cover_image: '',
              release_date: '',
              country: '',
              genre_1: '',
              genre_2: '',
            },
            // Album D: position 50 (should be excluded - beyond top 40)
            {
              list_id: 'list2',
              user_id: 'user2',
              position: 50,
              album_id: 'albumD',
              artist: 'Artist D',
              album: 'Album D',
              cover_image: '',
              release_date: '',
              country: '',
              genre_1: '',
              genre_2: '',
            },
            // Album E: position 10 in list1, position 45 in list2 (should be included - has top 40 position)
            {
              list_id: 'list2',
              user_id: 'user2',
              position: 10,
              album_id: 'albumE',
              artist: 'Artist E',
              album: 'Album E',
              cover_image: '',
              release_date: '',
              country: '',
              genre_1: '',
              genre_2: '',
            },
          ],
        },
      ]);
      const logger = createMockLogger();
      const aggregateList = createAggregateList({ pool, logger });

      const result = await aggregateList.aggregateForYear(2024);

      // Should only include albums A, B, and E (all have at least one position <= 40)
      assert.strictEqual(result.data.albums.length, 3);

      const albumA = result.data.albums.find((a) => a.albumId === 'albumA');
      const albumB = result.data.albums.find((a) => a.albumId === 'albumB');
      const albumE = result.data.albums.find((a) => a.albumId === 'albumE');
      const albumC = result.data.albums.find((a) => a.albumId === 'albumC');
      const albumD = result.data.albums.find((a) => a.albumId === 'albumD');

      assert.ok(albumA, 'Album A should be included');
      assert.strictEqual(albumA.totalPoints, 32); // Position 10 = 32 points
      assert.ok(albumB, 'Album B should be included');
      assert.strictEqual(albumB.totalPoints, 1); // Position 40 = 1 point
      assert.ok(albumE, 'Album E should be included');
      assert.strictEqual(albumE.totalPoints, 32); // Position 10 = 32 points (position 45 excluded)
      assert.strictEqual(albumC, undefined, 'Album C should be excluded');
      assert.strictEqual(albumD, undefined, 'Album D should be excluded');
    });

    it('should group albums with same name but different album_ids together', async () => {
      // This test verifies that albums are grouped by normalized artist::album key,
      // NOT by album_id. This prevents duplicates when the same album was added
      // from different sources (MusicBrainz, Spotify, Tidal, manual entry).
      const pool = createMockPool([
        {
          rows: [
            { list_id: 'list1', user_id: 'user1', username: 'alice' },
            { list_id: 'list2', user_id: 'user2', username: 'bob' },
            { list_id: 'list3', user_id: 'user3', username: 'carol' },
          ],
        },
        {
          rows: [
            // Alice added "OK Computer" from MusicBrainz
            {
              list_id: 'list1',
              user_id: 'user1',
              position: 1,
              album_id: 'mb-radiohead-ok-computer-uuid',
              artist: 'Radiohead',
              album: 'OK Computer',
              cover_image: '',
              release_date: '1997-05-21',
              country: 'UK',
              genre_1: 'Alternative Rock',
              genre_2: '',
            },
            // Bob added "OK Computer" from Spotify (different album_id!)
            {
              list_id: 'list2',
              user_id: 'user2',
              position: 2,
              album_id: 'spotify-6dVIqQ8qmQ5GBnJ9shOYGE',
              artist: 'Radiohead',
              album: 'OK Computer',
              cover_image: '',
              release_date: '1997-05-21',
              country: 'UK',
              genre_1: 'Alternative Rock',
              genre_2: '',
            },
            // Carol added "OK Computer" manually (yet another album_id!)
            {
              list_id: 'list3',
              user_id: 'user3',
              position: 3,
              album_id: 'manual-1234567890',
              artist: 'Radiohead',
              album: 'OK Computer',
              cover_image: '',
              release_date: '1997',
              country: 'UK',
              genre_1: 'Rock',
              genre_2: '',
            },
            // A different album for comparison
            {
              list_id: 'list1',
              user_id: 'user1',
              position: 2,
              album_id: 'mb-nirvana-nevermind',
              artist: 'Nirvana',
              album: 'Nevermind',
              cover_image: '',
              release_date: '1991-09-24',
              country: 'US',
              genre_1: 'Grunge',
              genre_2: '',
            },
          ],
        },
      ]);
      const logger = createMockLogger();
      const aggregateList = createAggregateList({ pool, logger });

      const result = await aggregateList.aggregateForYear(2024);

      // Should only have 2 unique albums (OK Computer grouped, Nevermind separate)
      assert.strictEqual(
        result.data.albums.length,
        2,
        'Should have exactly 2 albums (OK Computer grouped together, Nevermind separate)'
      );

      // Find OK Computer - it should have 3 voters despite different album_ids
      const okComputer = result.data.albums.find(
        (a) => a.album.toLowerCase() === 'ok computer'
      );
      assert.ok(okComputer, 'OK Computer should exist in results');
      assert.strictEqual(
        okComputer.voterCount,
        3,
        'OK Computer should have 3 voters (from 3 different album_ids)'
      );
      assert.strictEqual(
        okComputer.totalPoints,
        60 + 54 + 50,
        'OK Computer should have points from all 3 positions'
      ); // pos 1 + pos 2 + pos 3
      assert.strictEqual(
        okComputer.voters.length,
        3,
        'Should have 3 voter entries'
      );

      // Verify all voters are listed
      const voterUsernames = okComputer.voters.map((v) => v.username).sort();
      assert.deepStrictEqual(
        voterUsernames,
        ['alice', 'bob', 'carol'],
        'All three voters should be listed'
      );

      // Nevermind should have 1 voter
      const nevermind = result.data.albums.find(
        (a) => a.album.toLowerCase() === 'nevermind'
      );
      assert.ok(nevermind, 'Nevermind should exist in results');
      assert.strictEqual(nevermind.voterCount, 1);
    });

    it('should handle case-insensitive and whitespace-normalized grouping', async () => {
      // Same album with different casing/whitespace should be grouped together
      const pool = createMockPool([
        {
          rows: [
            { list_id: 'list1', user_id: 'user1', username: 'alice' },
            { list_id: 'list2', user_id: 'user2', username: 'bob' },
          ],
        },
        {
          rows: [
            // Album with title case
            {
              list_id: 'list1',
              user_id: 'user1',
              position: 1,
              album_id: 'id1',
              artist: 'The Beatles',
              album: 'Abbey Road',
              cover_image: '',
              release_date: '',
              country: '',
              genre_1: '',
              genre_2: '',
            },
            // Same album with different casing and extra whitespace
            {
              list_id: 'list2',
              user_id: 'user2',
              position: 5,
              album_id: 'id2',
              artist: '  the beatles  ',
              album: 'ABBEY ROAD',
              cover_image: '',
              release_date: '',
              country: '',
              genre_1: '',
              genre_2: '',
            },
          ],
        },
      ]);
      const logger = createMockLogger();
      const aggregateList = createAggregateList({ pool, logger });

      const result = await aggregateList.aggregateForYear(2024);

      // Should have only 1 album (both entries grouped together)
      assert.strictEqual(
        result.data.albums.length,
        1,
        'Should have exactly 1 album after case-insensitive grouping'
      );

      const abbeyRoad = result.data.albums[0];
      assert.strictEqual(abbeyRoad.voterCount, 2, 'Should have 2 voters');
      assert.strictEqual(
        abbeyRoad.totalPoints,
        60 + 43,
        'Should have combined points'
      ); // pos 1 + pos 5
    });
  });

  // ===========================================================================
  // get tests
  // ===========================================================================

  describe('get', () => {
    it('should return null when aggregate list does not exist', async () => {
      const pool = createMockPool([{ rows: [] }]);
      const aggregateList = createAggregateList({ pool });

      const result = await aggregateList.get(2024);
      assert.strictEqual(result, null);
    });

    it('should return aggregate list record when it exists', async () => {
      const mockRecord = {
        year: 2024,
        revealed: true,
        revealed_at: new Date(),
        data: { albums: [] },
        stats: {},
      };
      const pool = createMockPool([{ rows: [mockRecord] }]);
      const aggregateList = createAggregateList({ pool });

      const result = await aggregateList.get(2024);
      assert.deepStrictEqual(result, mockRecord);
    });
  });

  // ===========================================================================
  // getStatus tests
  // ===========================================================================

  describe('getStatus', () => {
    it('should return exists: false when aggregate list does not exist', async () => {
      const pool = createMockPool([{ rows: [] }]);
      const aggregateList = createAggregateList({ pool });

      const status = await aggregateList.getStatus(2024);

      assert.strictEqual(status.exists, false);
      assert.strictEqual(status.revealed, false);
      assert.deepStrictEqual(status.confirmations, []);
      assert.strictEqual(status.confirmationCount, 0);
      assert.strictEqual(status.requiredConfirmations, 2);
    });

    it('should return correct status with confirmations', async () => {
      const pool = createMockPool([
        // get() query
        { rows: [{ year: 2024, revealed: false }] },
        // confirmations query
        {
          rows: [{ username: 'admin1', confirmed_at: new Date('2024-01-01') }],
        },
      ]);
      const aggregateList = createAggregateList({ pool });

      const status = await aggregateList.getStatus(2024);

      assert.strictEqual(status.exists, true);
      assert.strictEqual(status.revealed, false);
      assert.strictEqual(status.confirmationCount, 1);
      assert.strictEqual(status.confirmations[0].username, 'admin1');
    });
  });

  // ===========================================================================
  // addConfirmation tests
  // ===========================================================================

  describe('addConfirmation', () => {
    it('should return alreadyRevealed when list is already revealed', async () => {
      const pool = createMockPool([
        // get() query - already revealed
        { rows: [{ year: 2024, revealed: true }] },
        // getStatus confirmations query
        { rows: [] },
      ]);
      const logger = createMockLogger();
      const aggregateList = createAggregateList({ pool, logger });

      const result = await aggregateList.addConfirmation(2024, 'admin1');

      assert.strictEqual(result.alreadyRevealed, true);
    });

    it('should add confirmation and not reveal with only 1 confirmation', async () => {
      const pool = createMockPool([
        // get() query
        { rows: [{ year: 2024, revealed: false }] },
        // insert confirmation
        { rows: [] },
        // count confirmations
        { rows: [{ count: '1' }] },
        // getStatus - get()
        { rows: [{ year: 2024, revealed: false }] },
        // getStatus - confirmations
        { rows: [{ username: 'admin1', confirmed_at: new Date() }] },
      ]);
      const logger = createMockLogger();
      const aggregateList = createAggregateList({ pool, logger });

      const result = await aggregateList.addConfirmation(2024, 'admin1');

      assert.strictEqual(result.revealed, false);
      assert.strictEqual(result.status.confirmationCount, 1);
    });

    it('should reveal list when 2 confirmations are reached', async () => {
      const pool = createMockPool([
        // get() query
        { rows: [{ year: 2024, revealed: false }] },
        // insert confirmation
        { rows: [] },
        // count confirmations
        { rows: [{ count: '2' }] },
        // update revealed
        { rows: [] },
        // getStatus - get()
        { rows: [{ year: 2024, revealed: true, revealed_at: new Date() }] },
        // getStatus - confirmations
        {
          rows: [
            { username: 'admin1', confirmed_at: new Date() },
            { username: 'admin2', confirmed_at: new Date() },
          ],
        },
      ]);
      const logger = createMockLogger();
      const aggregateList = createAggregateList({ pool, logger });

      const result = await aggregateList.addConfirmation(2024, 'admin2');

      assert.strictEqual(result.revealed, true);
    });
  });

  // ===========================================================================
  // removeConfirmation tests
  // ===========================================================================

  describe('removeConfirmation', () => {
    it('should return alreadyRevealed when list is already revealed', async () => {
      const pool = createMockPool([
        // get() query
        { rows: [{ year: 2024, revealed: true }] },
        // getStatus - get()
        { rows: [{ year: 2024, revealed: true }] },
        // getStatus - confirmations
        { rows: [] },
      ]);
      const logger = createMockLogger();
      const aggregateList = createAggregateList({ pool, logger });

      const result = await aggregateList.removeConfirmation(2024, 'admin1');

      assert.strictEqual(result.alreadyRevealed, true);
    });

    it('should remove confirmation successfully', async () => {
      const pool = createMockPool([
        // get() query
        { rows: [{ year: 2024, revealed: false }] },
        // delete confirmation
        { rows: [] },
        // getStatus - get()
        { rows: [{ year: 2024, revealed: false }] },
        // getStatus - confirmations
        { rows: [] },
      ]);
      const logger = createMockLogger();
      const aggregateList = createAggregateList({ pool, logger });

      const result = await aggregateList.removeConfirmation(2024, 'admin1');

      assert.ok(result.status);
      assert.strictEqual(result.status.confirmationCount, 0);
    });
  });

  // ===========================================================================
  // getStats tests
  // ===========================================================================

  describe('getStats', () => {
    it('should return null when aggregate list does not exist', async () => {
      const pool = createMockPool([{ rows: [] }]);
      const aggregateList = createAggregateList({ pool });

      const stats = await aggregateList.getStats(2024);
      assert.strictEqual(stats, null);
    });

    it('should return stats when aggregate list exists', async () => {
      const mockStats = { participantCount: 5, totalAlbums: 42 };
      const pool = createMockPool([{ rows: [{ stats: mockStats }] }]);
      const aggregateList = createAggregateList({ pool });

      const stats = await aggregateList.getStats(2024);
      assert.deepStrictEqual(stats, mockStats);
    });
  });

  // ===========================================================================
  // getRevealedYears tests
  // ===========================================================================

  describe('getRevealedYears', () => {
    it('should return empty array when no revealed lists', async () => {
      const pool = createMockPool([{ rows: [] }]);
      const aggregateList = createAggregateList({ pool });

      const years = await aggregateList.getRevealedYears();
      assert.deepStrictEqual(years, []);
    });

    it('should return revealed years in descending order', async () => {
      const pool = createMockPool([
        {
          rows: [
            { year: 2024, revealed_at: new Date('2024-12-25') },
            { year: 2023, revealed_at: new Date('2023-12-25') },
          ],
        },
      ]);
      const aggregateList = createAggregateList({ pool });

      const years = await aggregateList.getRevealedYears();
      assert.strictEqual(years.length, 2);
      assert.strictEqual(years[0].year, 2024);
      assert.strictEqual(years[1].year, 2023);
    });
  });

  // ===========================================================================
  // recompute tests
  // ===========================================================================

  describe('recompute', () => {
    it('should aggregate and store aggregate list', async () => {
      const pool = createMockPool([
        // aggregateForYear - main lists
        { rows: [{ list_id: 'list1', user_id: 'user1', username: 'alice' }] },
        // aggregateForYear - list items
        {
          rows: [
            {
              list_id: 'list1',
              user_id: 'user1',
              position: 1,
              album_id: 'album1',
              artist: 'Artist',
              album: 'Album',
              cover_image: '',
              release_date: '',
              country: '',
              genre_1: '',
              genre_2: '',
            },
          ],
        },
        // upsert query
        { rows: [{ year: 2024, data: {}, stats: {} }] },
      ]);
      const logger = createMockLogger();
      const aggregateList = createAggregateList({ pool, logger });

      const result = await aggregateList.recompute(2024);

      assert.ok(result);
      // Verify upsert was called (3rd query)
      assert.strictEqual(pool.query.mock.calls.length, 3);
    });
  });

  // ===========================================================================
  // Contributor Management tests
  // ===========================================================================

  describe('getContributors', () => {
    it('should return empty array when no contributors exist', async () => {
      const pool = createMockPool([{ rows: [] }]);
      const aggregateList = createAggregateList({ pool });

      const contributors = await aggregateList.getContributors(2024);
      assert.deepStrictEqual(contributors, []);
    });

    it('should return contributors with user info', async () => {
      const mockContributors = [
        {
          user_id: 'user1',
          added_at: new Date('2024-12-01'),
          username: 'alice',
          email: 'alice@test.com',
          added_by_username: 'admin',
        },
        {
          user_id: 'user2',
          added_at: new Date('2024-12-02'),
          username: 'bob',
          email: 'bob@test.com',
          added_by_username: 'admin',
        },
      ];
      const pool = createMockPool([{ rows: mockContributors }]);
      const aggregateList = createAggregateList({ pool });

      const contributors = await aggregateList.getContributors(2024);
      assert.strictEqual(contributors.length, 2);
      assert.strictEqual(contributors[0].username, 'alice');
      assert.strictEqual(contributors[1].username, 'bob');
    });
  });

  describe('getEligibleUsers', () => {
    it('should return empty array when no users have main lists', async () => {
      const pool = createMockPool([{ rows: [] }]);
      const aggregateList = createAggregateList({ pool });

      const eligibleUsers = await aggregateList.getEligibleUsers(2024);
      assert.deepStrictEqual(eligibleUsers, []);
    });

    it('should return eligible users with contributor status', async () => {
      const mockUsers = [
        {
          user_id: 'user1',
          username: 'alice',
          email: 'alice@test.com',
          list_id: 'list1',
          list_name: 'AOTY 2024',
          album_count: 25,
          is_contributor: true,
        },
        {
          user_id: 'user2',
          username: 'bob',
          email: 'bob@test.com',
          list_id: 'list2',
          list_name: 'Best of 2024',
          album_count: 40,
          is_contributor: false,
        },
      ];
      const pool = createMockPool([{ rows: mockUsers }]);
      const aggregateList = createAggregateList({ pool });

      const eligibleUsers = await aggregateList.getEligibleUsers(2024);
      assert.strictEqual(eligibleUsers.length, 2);
      assert.strictEqual(eligibleUsers[0].is_contributor, true);
      assert.strictEqual(eligibleUsers[1].is_contributor, false);
    });
  });

  describe('addContributor', () => {
    it('should add a contributor successfully', async () => {
      const pool = createMockPool([{ rows: [] }]);
      const logger = createMockLogger();
      const aggregateList = createAggregateList({ pool, logger });

      const result = await aggregateList.addContributor(
        2024,
        'user1',
        'admin1'
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(pool.query.mock.calls.length, 1);
      // Verify the query contains correct parameters
      const queryCall = pool.query.mock.calls[0];
      assert.ok(
        queryCall.arguments[0].includes(
          'INSERT INTO aggregate_list_contributors'
        )
      );
    });
  });

  describe('removeContributor', () => {
    it('should remove a contributor and return removed: true', async () => {
      const pool = createMockPool([
        { rows: [{ user_id: 'user1' }], rowCount: 1 },
      ]);
      const logger = createMockLogger();
      const aggregateList = createAggregateList({ pool, logger });

      const result = await aggregateList.removeContributor(2024, 'user1');

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.removed, true);
    });

    it('should return removed: false when contributor does not exist', async () => {
      const pool = createMockPool([{ rows: [], rowCount: 0 }]);
      const logger = createMockLogger();
      const aggregateList = createAggregateList({ pool, logger });

      const result = await aggregateList.removeContributor(2024, 'nonexistent');

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.removed, false);
    });
  });

  describe('setContributors', () => {
    it('should set contributors in bulk', async () => {
      // Create a mock client for transaction
      const mockClient = {
        query: mock.fn(async () => ({ rows: [] })),
        release: mock.fn(),
      };
      const pool = {
        query: mock.fn(),
        connect: mock.fn(async () => mockClient),
      };
      const logger = createMockLogger();
      const aggregateList = createAggregateList({ pool, logger });

      const result = await aggregateList.setContributors(
        2024,
        ['user1', 'user2', 'user3'],
        'admin1'
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.count, 3);
      // Verify transaction was used
      assert.strictEqual(pool.connect.mock.calls.length, 1);
      assert.strictEqual(mockClient.release.mock.calls.length, 1);
      // Verify BEGIN, DELETE, INSERT, COMMIT were called
      assert.strictEqual(mockClient.query.mock.calls.length, 4);
    });

    it('should handle empty userIds array', async () => {
      const mockClient = {
        query: mock.fn(async () => ({ rows: [] })),
        release: mock.fn(),
      };
      const pool = {
        query: mock.fn(),
        connect: mock.fn(async () => mockClient),
      };
      const logger = createMockLogger();
      const aggregateList = createAggregateList({ pool, logger });

      const result = await aggregateList.setContributors(2024, [], 'admin1');

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.count, 0);
      // Should only have BEGIN, DELETE, COMMIT (no INSERT for empty array)
      assert.strictEqual(mockClient.query.mock.calls.length, 3);
    });

    it('should rollback on error', async () => {
      const mockClient = {
        query: mock.fn(async (sql) => {
          if (sql.includes('INSERT')) {
            throw new Error('Database error');
          }
          return { rows: [] };
        }),
        release: mock.fn(),
      };
      const pool = {
        query: mock.fn(),
        connect: mock.fn(async () => mockClient),
      };
      const logger = createMockLogger();
      const aggregateList = createAggregateList({ pool, logger });

      await assert.rejects(
        async () => aggregateList.setContributors(2024, ['user1'], 'admin1'),
        /Database error/
      );

      // Verify ROLLBACK was called
      const queries = mockClient.query.mock.calls.map((c) => c.arguments[0]);
      assert.ok(queries.includes('ROLLBACK'));
    });
  });

  describe('aggregateForYear with contributors filter', () => {
    it('should only include users who are approved contributors', async () => {
      // This test verifies the SQL query filters by contributor table
      const pool = createMockPool([
        // The query now includes a subquery to filter by contributors
        { rows: [] }, // No results because no one is a contributor
      ]);
      const logger = createMockLogger();
      const aggregateList = createAggregateList({ pool, logger });

      const result = await aggregateList.aggregateForYear(2024);

      // Verify the query includes the contributors filter
      const queryCall = pool.query.mock.calls[0];
      assert.ok(
        queryCall.arguments[0].includes('aggregate_list_contributors'),
        'Query should filter by aggregate_list_contributors table'
      );

      // With no contributors, result should be empty
      assert.strictEqual(result.data.participantCount, 0);
      assert.deepStrictEqual(result.data.albums, []);
    });
  });
});
