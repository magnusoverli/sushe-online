const { normalizeOdesliPlatform } = require('./platforms');

const MB_LINK_CONFIDENCE = 0.9;

function buildCandidates({
  odesliLinks,
  seedKind,
  seedConfidence,
  mbLinks,
  directContributions,
}) {
  const candidates = [];

  for (const link of odesliLinks) {
    candidates.push({
      service: normalizeOdesliPlatform(link.platform),
      url: link.url,
      confidence: seedConfidence,
      strategy: `availability:${seedKind}`,
    });
  }

  for (const link of mbLinks) {
    candidates.push({
      service: link.service,
      url: link.url,
      confidence: MB_LINK_CONFIDENCE,
      strategy: 'availability:musicbrainz',
    });
  }

  for (const contribution of directContributions) {
    for (const link of contribution.links) {
      candidates.push({
        service: link.service,
        url: link.url,
        confidence: link.confidence,
        strategy: `availability:${contribution.name}`,
        externalAlbumId: link.externalAlbumId,
        externalArtist: link.externalArtist,
        externalAlbum: link.externalAlbum,
      });
    }
  }

  return candidates;
}

module.exports = { MB_LINK_CONFIDENCE, buildCandidates };
