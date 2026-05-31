/**
 * Qobuz availability source.
 *
 * Qobuz is poorly covered by Odesli for this catalog, but its public album
 * search page embeds structured album results. This source uses that public
 * result payload and the shared entity matcher to confirm album availability.
 */

const defaultLogger = require('../../utils/logger');
const {
  generateQueryForms,
  selectBestCandidate,
} = require('../../utils/entity-matching');
const { stripEditionSuffix } = require('../../utils/normalization');

const QOBUZ_BASE_URL = 'https://www.qobuz.com';
const QOBUZ_STORE = 'no-en';

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_match, code) =>
      String.fromCodePoint(parseInt(code, 10))
    );
}

function parseQobuzSearchPage(html) {
  const matches = String(html || '').matchAll(
    /data-live-props-value="([^"]+)"/g
  );

  for (const match of matches) {
    try {
      const props = JSON.parse(decodeHtmlEntities(match[1]));
      if (!props.albums) continue;
      const albums = JSON.parse(props.albums);
      return Object.values(albums).map((album) => ({
        id: album.id,
        slug: album.slug,
        title: album.title,
        artist: Array.isArray(album.artists)
          ? album.artists.map((artist) => artist.name).join(' ')
          : '',
      }));
    } catch {
      // Keep scanning: Qobuz pages may contain unrelated live components.
    }
  }
  return [];
}

function buildQobuzAlbumUrl({ baseUrl, store, slug, id }) {
  if (!slug || !id) return null;
  return `${baseUrl}/${store}/album/${slug}/${id}`;
}

function buildSearchUrl({ baseUrl, store, artist, album }) {
  const albumForm =
    generateQueryForms(album, { stripEditions: true })[0] || album;
  const artistForm = generateQueryForms(artist)[0] || artist;
  const query = `${artistForm} ${albumForm}`.trim();
  return `${baseUrl}/${store}/search/albums/${encodeURIComponent(query)}`;
}

function createQobuzSource(deps = {}) {
  const fetchFn = deps.fetch || fetch;
  const logger = deps.logger || defaultLogger;
  const baseUrl = deps.baseUrl || QOBUZ_BASE_URL;
  const store = deps.store || process.env.QOBUZ_STORE || QOBUZ_STORE;

  async function getLinks(album = {}) {
    const artist = String(album.artist || '').trim();
    const albumName = String(album.album || '').trim();
    if (!artist || !albumName) return { links: [] };

    try {
      const resp = await fetchFn(
        buildSearchUrl({ baseUrl, store, artist, album: albumName })
      );
      if (!resp.ok) return { links: [] };

      const candidates = parseQobuzSearchPage(await resp.text());
      const prepared = candidates.map((candidate) => ({
        ...candidate,
        matchingTitle: stripEditionSuffix(candidate.title || ''),
      }));
      const { best, isConfident } = selectBestCandidate({
        target: { artist, album: albumName },
        candidates: prepared,
        getArtist: (candidate) => candidate.artist,
        getAlbum: (candidate) => candidate.matchingTitle,
      });

      if (!isConfident || !best?.candidate?.id) return { links: [] };

      const match = best.candidate;
      const url = buildQobuzAlbumUrl({
        baseUrl,
        store,
        slug: match.slug,
        id: match.id,
      });
      if (!url) return { links: [] };

      return {
        links: [
          {
            service: 'qobuz',
            url,
            confidence: best.combined,
            externalAlbumId: match.id,
            externalArtist: match.artist,
            externalAlbum: match.title,
          },
        ],
      };
    } catch (err) {
      logger.debug?.('Qobuz availability lookup failed', {
        artist,
        album: albumName,
        error: err.message,
      });
      return { links: [] };
    }
  }

  return { getLinks };
}

module.exports = {
  createQobuzSource,
  parseQobuzSearchPage,
  buildQobuzAlbumUrl,
  buildSearchUrl,
};
