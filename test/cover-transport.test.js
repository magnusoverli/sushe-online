const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCoverTransport } = require('../services/cover-transport');

test('compact artwork cannot expand beyond the decoded pixel budget', async () => {
  const { processCoverImageVariants } = require('../utils/image-processing');
  const vector = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="7000" height="7000"><rect width="7000" height="7000" fill="red"/></svg>'
  );
  await assert.rejects(processCoverImageVariants(vector), /pixel limit/i);
});

test('provider-supplied artwork uses the public DNS-pinned transport and a bounded image policy', async () => {
  let options;
  const fetch = createCoverTransport({
    fetch: async () => assert.fail('Artwork used trusted credential transport'),
    publicRequest: async (_url, policy) => {
      options = policy;
      return { buffer: Buffer.from('image'), contentType: 'image/jpeg' };
    },
  });
  const response = await fetch('https://cdn.example.test/art.jpg');
  assert.equal(await response.text(), 'image');
  assert.equal(options.maxBytes, 8 * 1024 * 1024);
  assert.deepEqual(options.contentTypes, ['image/']);
  assert.ok(options.signal);
});

test('provider artwork cannot reach loopback or send credentials', async () => {
  const fetch = createCoverTransport();
  await assert.rejects(
    fetch('http://127.0.0.1/image'),
    /public|not allowed|private/i
  );
  const { publicRequest } = require('../utils/public-request');
  await assert.rejects(
    publicRequest('https://example.test', {
      headers: { Authorization: 'Bearer secret' },
    }),
    /credentials/
  );
});
