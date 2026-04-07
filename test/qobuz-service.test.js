const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const { createQobuzService } = require('../services/qobuz-service.js');
const { createMockLogger } = require('./helpers');

describe('qobuz-service', () => {
  it('should extract unique album candidates from search html', () => {
    const service = createQobuzService({
      fetch: mock.fn(),
      logger: createMockLogger(),
    });

    const html = `
      <a href="/us-en/album/ok-computer-radiohead/0060252792762">OK</a>
      <a href="/us-en/album/ok-computer-oknotok-radiohead/190295851286">OKNOTOK</a>
      <a href="/us-en/album/ok-computer-radiohead/0060252792762">Duplicate</a>
    `;

    const candidates = service.extractAlbumCandidates(html, 'us-en');

    assert.deepStrictEqual(candidates, [
      { id: '0060252792762', slug: 'ok-computer-radiohead' },
      { id: '190295851286', slug: 'ok-computer-oknotok-radiohead' },
    ]);
  });

  it('should pick the best candidate for artist and album', () => {
    const service = createQobuzService({
      fetch: mock.fn(),
      logger: createMockLogger(),
    });

    const best = service.pickBestCandidate(
      [
        { id: '1', slug: 'completely-unrelated-record' },
        { id: '2', slug: 'ok-computer-radiohead' },
      ],
      'Radiohead',
      'OK Computer'
    );

    assert.ok(best);
    assert.strictEqual(best.id, '2');
  });

  it('should return null when no good candidate exists', () => {
    const service = createQobuzService({
      fetch: mock.fn(),
      logger: createMockLogger(),
    });

    const best = service.pickBestCandidate(
      [{ id: '1', slug: 'electronic-dance-sampler-vol-5' }],
      'Radiohead',
      'OK Computer'
    );

    assert.strictEqual(best, null);
  });

  it('should search Qobuz and return album id', async () => {
    const fetch = mock.fn(() =>
      Promise.resolve({
        ok: true,
        text: () =>
          Promise.resolve(
            '<a href="/us-en/album/ok-computer-radiohead/0060252792762">OK</a>'
          ),
      })
    );

    const service = createQobuzService({
      fetch,
      logger: createMockLogger(),
    });

    const result = await service.searchAlbum('Radiohead', 'OK Computer');

    assert.deepStrictEqual(result, { id: '0060252792762' });
    const searchUrl = fetch.mock.calls[0].arguments[0];
    assert.ok(searchUrl.includes('/us-en/search?q=Radiohead%20OK%20Computer'));
  });

  it('should return null when artist or album is missing', async () => {
    const fetch = mock.fn();
    const service = createQobuzService({
      fetch,
      logger: createMockLogger(),
    });

    const noArtist = await service.searchAlbum('', 'OK Computer');
    const noAlbum = await service.searchAlbum('Radiohead', '');

    assert.strictEqual(noArtist, null);
    assert.strictEqual(noAlbum, null);
    assert.strictEqual(fetch.mock.calls.length, 0);
  });

  it('should throw when qobuz search request fails', async () => {
    const logger = createMockLogger();
    const service = createQobuzService({
      fetch: mock.fn(() => Promise.resolve({ ok: false, status: 503 })),
      logger,
    });

    await assert.rejects(
      () => service.searchAlbum('Radiohead', 'OK Computer'),
      /Qobuz search failed: 503/
    );
    assert.strictEqual(logger.warn.mock.calls.length, 1);
  });
});
