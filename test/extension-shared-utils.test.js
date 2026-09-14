const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../browser-extension/shared-utils');
require('../browser-extension/extension-constants');
require('../browser-extension/album-api-service');
const { fetchApiWithTimeout, fetchWithTimeout, readApiError } =
  globalThis.SharedUtils;

test('API transport omits cookies, preserves explicit bearer/body, and leaves generic fetch policy alone', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return new globalThis.Response('{}');
  });
  const options = {
    method: 'PATCH',
    credentials: 'include',
    headers: { Authorization: 'Bearer token' },
    body: '{}',
  };
  await fetchApiWithTimeout('https://sushe.test/api/lists', options);
  assert.equal(calls[0].options.credentials, 'omit');
  assert.deepEqual(calls[0].options.headers, options.headers);
  assert.equal(calls[0].options.body, '{}');
  assert.equal(options.credentials, 'include');
  await fetchApiWithTimeout('https://sushe.test/api/lists');
  assert.equal(calls[1].options.credentials, 'omit');
  await fetchWithTimeout('https://rateyourmusic.com/', {
    credentials: 'same-origin',
  });
  assert.equal(calls[2].options.credentials, 'same-origin');
});

test('all album API requests retain bearer auth and omit browser credentials', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return new globalThis.Response(
      JSON.stringify({ 'release-groups': [{ id: 'album-1' }], country: 'CL' })
    );
  });
  const service = globalThis.AlbumApiService.createAlbumApiService({
    fetchWithTimeout: fetchApiWithTimeout,
    getAuthHeaders: () => ({ Authorization: 'Bearer token' }),
    handleUnauthorized: async () => {},
    logger: { log() {} },
  });
  const base = 'https://sushe.test';
  await service.searchMusicBrainz(base, { artist: 'Artist', album: 'Album' });
  await service.fetchArtistCountry(base, {
    'artist-credit': [{ artist: { id: 'artist-1' } }],
  });
  await service.saveAlbum(base, 'list-1', { album_id: 'album-1' });
  await service.updateAlbumMetadata(base, [
    { albumId: 'album-1', country: 'CL' },
  ]);
  await service.updateSourceObservation(base, 'album-1', { schemaVersion: 1 });
  assert.equal(calls.length, 5);
  assert.ok(
    calls.every(
      ({ options }) =>
        options.credentials === 'omit' &&
        options.headers.Authorization === 'Bearer token'
    )
  );
  assert.deepEqual(
    calls.map(({ options }) => options.method || 'GET'),
    ['GET', 'GET', 'PATCH', 'PATCH', 'PUT']
  );
});

test('API timeouts still abort the request', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true }
        );
      })
  );
  await assert.rejects(
    fetchApiWithTimeout('https://sushe.test', {}, 10),
    /Request timed out/
  );
});

test('API errors support both envelopes and retain status/code without stringifying objects', async () => {
  for (const [body, expected] of [
    [
      { code: 'CSRF_INVALID', error: { message: 'Invalid CSRF token' } },
      'Invalid CSRF token',
    ],
    [{ error: 'List is locked' }, 'List is locked'],
    [{ error: {} }, 'Save failed (HTTP 403)'],
    [{ error: { message: 123 } }, 'Save failed (HTTP 403)'],
    [null, 'Save failed (HTTP 403)'],
    ['<html>Forbidden</html>', 'Save failed (HTTP 403)'],
  ]) {
    const response = new globalThis.Response(
      typeof body === 'string' ? body : JSON.stringify(body),
      { status: 403 }
    );
    const error = await readApiError(response, 'Save failed');
    assert.equal(error.message, expected);
    assert.equal(error.status, 403);
    assert.equal(error.code, body?.code);
  }
});

test('HTTP status controls authentication cleanup even when the error message suggests otherwise', () => {
  const classify = globalThis.SharedUtils.classifyFetchError;
  assert.equal(
    classify({ status: 403, message: 'Unauthorized to change this list' }),
    'client'
  );
  assert.equal(classify({ status: 401, message: 'Expired token' }), 'auth');
  assert.equal(
    classify({ status: 503, message: 'Service unavailable' }),
    'server'
  );
});
