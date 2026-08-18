const MUSICBRAINZ_SEED_CONFIDENCE = 0.9;

function buildSeedCandidates(independentSeed, mbSeedUrl) {
  const mbSeed = mbSeedUrl
    ? {
        kind: 'musicbrainz',
        confidence: MUSICBRAINZ_SEED_CONFIDENCE,
        seed: { url: mbSeedUrl },
      }
    : null;
  if (!independentSeed) return mbSeed ? [mbSeed] : [];
  if (!mbSeed || independentSeed.kind === 'existing') {
    return [independentSeed, ...(mbSeed ? [mbSeed] : [])];
  }
  return [independentSeed, mbSeed].sort((a, b) => b.confidence - a.confidence);
}

async function expandSeedCandidates(odesliClient, seedCandidates) {
  const errors = [];
  for (const seedResult of seedCandidates) {
    try {
      const links = await odesliClient.fetchLinksBySeed(seedResult.seed);
      if (links.length > 0) return { links, seedResult, errors };
    } catch (error) {
      errors.push(error);
    }
  }
  return { links: [], seedResult: seedCandidates[0] || null, errors };
}

async function resolveSeedExpansionFallback({
  odesliClient,
  mbSeedUrl,
  initialExpansion,
  upcDirectPromise,
}) {
  if (initialExpansion.links.length > 0 || !mbSeedUrl) {
    return {
      upcDirect: await upcDirectPromise,
      expansion: initialExpansion,
    };
  }

  const [upcDirect, mbExpansion] = await Promise.all([
    upcDirectPromise,
    expandSeedCandidates(odesliClient, buildSeedCandidates(null, mbSeedUrl)),
  ]);
  return {
    upcDirect,
    expansion: {
      links: mbExpansion.links,
      seedResult: mbExpansion.seedResult || initialExpansion.seedResult,
      errors: [...initialExpansion.errors, ...mbExpansion.errors],
    },
  };
}

module.exports = {
  buildSeedCandidates,
  expandSeedCandidates,
  resolveSeedExpansionFallback,
};
