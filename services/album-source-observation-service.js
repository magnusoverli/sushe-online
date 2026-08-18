const {
  RYM_HINT_RANK,
  VERIFIED_MAPPING_RANK,
  createAlbumServiceMappingsRepository,
} = require('../db/repositories/album-service-mappings-repository');
const {
  normalizeRymSnapshot,
  normalizeTaxonomyTerm,
} = require('../utils/album-taxonomy');
const { AVAILABILITY_SERVICES } = require('./availability/platforms');
const { parseAlbumLink } = require('./external-identity/album-link-policy');
const { externalMatchKey } = require('../utils/entity-matching');

const RYM_SERVICE = 'rateyourmusic';
const PROVIDER_HINT_STRATEGY = 'availability:hint:rateyourmusic';
const SAVEPOINT = 'album_source_observation';

function field(value, camelName, snakeName) {
  if (value && Object.hasOwn(value, camelName)) return value[camelName];
  if (value && Object.hasOwn(value, snakeName)) return value[snakeName];
  return undefined;
}

function normalizeIdentityText(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  return normalizeTaxonomyTerm(value, fieldName);
}

function normalizeRymAlbumId(value) {
  if (value === undefined || value === null || value === '') return null;
  if (
    typeof value === 'number' &&
    (!Number.isSafeInteger(value) || value <= 0)
  ) {
    throw new TypeError(
      'sourceObservation.identity.albumId must be a positive safe integer'
    );
  }
  const normalized = String(value).trim();
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new TypeError(
      'sourceObservation.identity.albumId must be a positive integer'
    );
  }
  return normalized;
}

function normalizeCanonicalRymUrl(observation, identity, taxonomy) {
  const candidates = [
    field(identity, 'canonicalUrl', 'canonical_url'),
    field(observation, 'sourceUrl', 'source_url'),
    field(taxonomy, 'sourceUrl', 'source_url'),
  ].filter((value) => value !== undefined && value !== null && value !== '');
  if (candidates.length === 0) {
    throw new TypeError('sourceObservation requires a canonical RYM URL');
  }

  const links = candidates.map((value) => parseAlbumLink(value, RYM_SERVICE));
  if (links.some((link) => !link || link.linkType !== 'release')) {
    throw new TypeError(
      'sourceObservation canonical URL must be a valid RYM release URL'
    );
  }
  if (links.some((link) => link.externalUrl !== links[0].externalUrl)) {
    throw new TypeError('sourceObservation RYM URLs do not match');
  }
  return links[0].externalUrl;
}

function normalizeProviderHints(platformLinks) {
  if (platformLinks === undefined) return { hints: [], warnings: [] };
  if (!Array.isArray(platformLinks)) {
    throw new TypeError('sourceObservation.platformLinks must be an array');
  }

  const bestByService = new Map();
  const warnings = [];
  platformLinks.forEach((candidate, index) => {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate)
    ) {
      warnings.push({ index, message: 'platform link must be an object' });
      return;
    }
    const service = String(candidate.platform || candidate.service || '')
      .trim()
      .toLowerCase();
    if (!AVAILABILITY_SERVICES.includes(service)) {
      warnings.push({
        index,
        message: 'platform link has an unsupported platform',
      });
      return;
    }
    const link = parseAlbumLink(candidate.url, service);
    if (!link) {
      warnings.push({ index, message: 'platform link has an invalid URL' });
      return;
    }

    const current = bestByService.get(service);
    if (!current || link.rank > current.rank) bestByService.set(service, link);
  });
  return { hints: [...bestByService.values()], warnings };
}

function normalizeSourceObservation(observation) {
  if (
    !observation ||
    typeof observation !== 'object' ||
    Array.isArray(observation)
  ) {
    throw new TypeError('sourceObservation must be an object');
  }
  const schemaVersion = field(observation, 'schemaVersion', 'schema_version');
  if (schemaVersion !== 1) {
    throw new TypeError('sourceObservation.schemaVersion must be 1');
  }
  if (observation.source !== undefined && observation.source !== RYM_SERVICE) {
    throw new TypeError('sourceObservation.source must be rateyourmusic');
  }
  if (!observation.identity || typeof observation.identity !== 'object') {
    throw new TypeError('sourceObservation.identity must be an object');
  }

  const taxonomyContainer = observation.taxonomy || observation;
  const taxonomy = taxonomyContainer.rym || taxonomyContainer;
  const canonicalUrl = normalizeCanonicalRymUrl(
    observation,
    observation.identity,
    taxonomy
  );
  const taxonomyComplete =
    field(taxonomy, 'complete', 'complete') ?? observation.complete;
  const providerHints = normalizeProviderHints(observation.platformLinks);
  const snapshot =
    taxonomyComplete === true
      ? normalizeRymSnapshot({
          primaryGenres: field(taxonomy, 'primaryGenres', 'primary_genres'),
          secondaryGenres: field(
            taxonomy,
            'secondaryGenres',
            'secondary_genres'
          ),
          descriptors: field(taxonomy, 'descriptors', 'descriptors'),
          languages: field(taxonomy, 'languages', 'languages'),
          scenes: field(taxonomy, 'scenes', 'scenes'),
          movements: field(taxonomy, 'movements', 'movements'),
          releaseType: field(taxonomy, 'releaseType', 'release_type'),
          labels: field(taxonomy, 'labels', 'labels'),
          credits: field(taxonomy, 'credits', 'credits'),
          sourceUrl: canonicalUrl,
          extractorVersion:
            field(taxonomy, 'extractorVersion', 'extractor_version') ??
            field(observation, 'extractorVersion', 'extractor_version'),
          capturedAt: field(taxonomy, 'capturedAt', 'captured_at'),
          complete: true,
        })
      : null;

  return {
    identity: {
      albumId: normalizeRymAlbumId(
        field(observation.identity, 'numericId', 'numeric_id') ??
          field(observation.identity, 'albumId', 'album_id')
      ),
      artist: normalizeIdentityText(
        observation.identity.artist,
        'identity.artist'
      ),
      title: normalizeIdentityText(
        observation.identity.title,
        'identity.title'
      ),
      canonicalUrl,
    },
    snapshot,
    providerHints: providerHints.hints,
    providerWarnings: providerHints.warnings,
  };
}

function warning(index, albumId, code, message) {
  return { index, albumId, code, message };
}

function mappingMatchesObservation(mapping, identity) {
  if (!mapping || mapping.album_id !== identity.albumId) return false;
  if (
    identity.externalAlbumId &&
    mapping.external_album_id !== identity.externalAlbumId
  ) {
    return false;
  }
  return mapping.external_url === identity.canonicalUrl;
}

async function matchesCanonicalAlbum(client, albumId, identity) {
  if (!identity.artist || !identity.title) return true;
  const result = await client.query(
    'SELECT artist, album FROM albums WHERE album_id = $1',
    [albumId]
  );
  const canonical = result.rows[0];
  if (!canonical) return false;
  return (
    externalMatchKey(canonical.artist) === externalMatchKey(identity.artist) &&
    externalMatchKey(canonical.album) === externalMatchKey(identity.title)
  );
}

function createAlbumSourceObservationService(deps = {}) {
  const { albumTaxonomyService } = deps;
  const repositoryFactory =
    deps.repositoryFactory || createAlbumServiceMappingsRepository;
  const logger = deps.logger;
  if (!albumTaxonomyService)
    throw new Error('albumTaxonomyService is required');

  async function apply(client, albumId, observation, options = {}) {
    const index = options.index ?? null;
    let normalized;
    try {
      normalized = normalizeSourceObservation(observation);
    } catch (error) {
      return {
        result: { index, albumId, status: 'invalid' },
        warnings: [
          warning(index, albumId, 'invalid_source_observation', error.message),
        ],
      };
    }

    if (!(await matchesCanonicalAlbum(client, albumId, normalized.identity))) {
      return {
        result: {
          index,
          albumId,
          status: 'skipped',
          reason: 'canonical_identity_mismatch',
        },
        warnings: [
          warning(
            index,
            albumId,
            'canonical_identity_mismatch',
            'RYM identity does not match the canonical album'
          ),
        ],
      };
    }

    await client.query(`SAVEPOINT ${SAVEPOINT}`);
    try {
      const repository = repositoryFactory({ db: client });
      const rymMapping = await repository.upsertCandidate({
        albumId,
        service: RYM_SERVICE,
        externalAlbumId: normalized.identity.albumId,
        externalArtist: normalized.identity.artist,
        externalAlbum: normalized.identity.title,
        externalUrl: normalized.identity.canonicalUrl,
        confidence: 1,
        strategy: 'rym:observation',
        rank: normalized.identity.albumId
          ? VERIFIED_MAPPING_RANK
          : RYM_HINT_RANK,
        verified: !!normalized.identity.albumId,
      });

      if (
        !mappingMatchesObservation(rymMapping, {
          albumId,
          externalAlbumId: normalized.identity.albumId,
          canonicalUrl: normalized.identity.canonicalUrl,
        })
      ) {
        await client.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
        await client.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
        return {
          result: {
            index,
            albumId,
            status: 'skipped',
            reason: 'rym_identity_conflict',
          },
          warnings: [
            warning(
              index,
              albumId,
              'rym_identity_conflict',
              'RYM identity is already owned by another album'
            ),
          ],
        };
      }

      let taxonomyResult = null;
      if (normalized.snapshot) {
        taxonomyResult = await albumTaxonomyService.applyRymSnapshot(
          albumId,
          normalized.snapshot,
          {
            client,
          }
        );
      }
      for (const hint of normalized.providerHints) {
        await repository.upsertCandidate({
          albumId,
          service: hint.service,
          externalAlbumId: hint.externalAlbumId,
          externalUrl: hint.externalUrl,
          strategy: PROVIDER_HINT_STRATEGY,
          rank: RYM_HINT_RANK,
        });
      }
      await client.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);

      return {
        result: {
          index,
          albumId,
          status: 'applied',
          providerHints: normalized.providerHints.map((hint) => hint.service),
          taxonomyUpdatedAt: taxonomyResult?.taxonomy_updated_at || null,
        },
        warnings: normalized.providerWarnings.map((providerWarning) =>
          warning(
            index,
            albumId,
            'invalid_provider_hint',
            `platformLinks[${providerWarning.index}]: ${providerWarning.message}`
          )
        ),
      };
    } catch (error) {
      await client.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
      await client.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
      logger?.warn('Album source observation could not be applied', {
        albumId,
        index,
        error: error.message,
      });
      return {
        result: { index, albumId, status: 'failed' },
        warnings: [
          warning(
            index,
            albumId,
            'source_observation_failed',
            'Source observation could not be applied'
          ),
        ],
      };
    }
  }

  return { apply };
}

module.exports = {
  PROVIDER_HINT_STRATEGY,
  normalizeSourceObservation,
  createAlbumSourceObservationService,
};
