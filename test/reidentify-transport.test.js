const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createReidentifyService } = require('../services/reidentify-service');
const { createMockLogger } = require('./helpers');

test('reidentification resolves redirectable cover metadata through the public transport', async () => {
  let publicCalls = 0;
  const service = createReidentifyService({
    db: {
      raw: async () => {
        throw new Error('Search should not write to the database');
      },
    },
    logger: createMockLogger(),
    fetchFn: async (url) => {
      assert.ok(url.startsWith('https://musicbrainz.org/'));
      return globalThis.Response.json(
        url.includes('release-group/?')
          ? { 'release-groups': [{ id: 'synthetic-group', title: 'Album' }] }
          : { releases: [] }
      );
    },
    publicRequest: async (url, options) => {
      publicCalls++;
      assert.equal(
        url,
        'https://coverartarchive.org/release-group/synthetic-group'
      );
      assert.deepEqual(options.contentTypes, ['application/json']);
      return {
        buffer: Buffer.from(
          JSON.stringify({
            images: [{ front: true, image: 'https://archive.org/cover.jpg' }],
          })
        ),
      };
    },
  });
  const result = await service.searchCandidates('Artist', 'Album', 'current');
  assert.equal(result.candidates.length, 1);
  assert.equal(publicCalls, 1);
});
