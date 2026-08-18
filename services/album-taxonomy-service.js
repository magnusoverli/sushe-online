const logger = require('../utils/logger');
const { TransactionAbort } = require('../db/transaction');
const {
  deriveGenreProjection,
  normalizeRymSnapshot,
  normalizeTaxonomyTerm,
  normalizeTaxonomyText,
  projectTaxonomyForRead,
} = require('../utils/album-taxonomy');

const GENRE_FIELDS = ['genre_1', 'genre_2'];
const OPTIONAL_RYM_FIELDS = [
  'languages',
  'scenes',
  'movements',
  'release_type',
  'labels',
  'credits',
];

function parseTaxonomy(value) {
  const taxonomy = typeof value === 'string' ? JSON.parse(value) : value;
  if (
    !taxonomy ||
    typeof taxonomy !== 'object' ||
    Array.isArray(taxonomy) ||
    taxonomy.schema_version !== 1 ||
    !taxonomy.manual_overrides ||
    typeof taxonomy.manual_overrides !== 'object' ||
    Array.isArray(taxonomy.manual_overrides)
  ) {
    throw new Error('Album taxonomy has an invalid stored shape');
  }
  return {
    ...taxonomy,
    manual_overrides: { ...taxonomy.manual_overrides },
  };
}

function valuesMatch(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  return (
    normalizeTaxonomyText(left).toLowerCase() ===
    normalizeTaxonomyText(right).toLowerCase()
  );
}

function reconcileLegacyOverrides(taxonomy, rymProjection) {
  GENRE_FIELDS.forEach((field) => {
    const override = taxonomy.manual_overrides[field];
    if (
      override?.source === 'legacy_backfill' &&
      valuesMatch(override.value, rymProjection[field])
    ) {
      delete taxonomy.manual_overrides[field];
    }
  });
}

function deriveStoredGenres(taxonomy) {
  const rymProjection = deriveGenreProjection(taxonomy.rym);
  return Object.fromEntries(
    GENRE_FIELDS.map((field) => [
      field,
      Object.hasOwn(taxonomy.manual_overrides, field)
        ? taxonomy.manual_overrides[field].value || ''
        : rymProjection[field],
    ])
  );
}

function preserveOmittedRymFields(snapshot, previousSnapshot) {
  if (!previousSnapshot) return snapshot;
  OPTIONAL_RYM_FIELDS.forEach((field) => {
    if (
      !Object.hasOwn(snapshot, field) &&
      Object.hasOwn(previousSnapshot, field)
    ) {
      snapshot[field] = previousSnapshot[field];
    }
  });
  return snapshot;
}

function formatMutationResult(row) {
  return {
    album_id: row.album_id,
    album_taxonomy: projectTaxonomyForRead(row.album_taxonomy),
    genre_1: row.genre_1,
    genre_2: row.genre_2,
    taxonomy_updated_at: row.taxonomy_updated_at,
  };
}

function createAlbumTaxonomyService(deps = {}) {
  const { db } = deps;
  const log = deps.logger || logger;
  if (!db) throw new Error('db is required');

  async function updateLockedAlbum(client, albumId, mutateTaxonomy) {
    const locked = await client.query(
      `SELECT album_taxonomy
       FROM albums
       WHERE album_id = $1
       FOR UPDATE`,
      [albumId]
    );
    if (locked.rowCount === 0 || !locked.rows[0]) {
      throw new TransactionAbort(404, { error: 'Album not found' });
    }

    const taxonomy = parseTaxonomy(locked.rows[0].album_taxonomy);
    mutateTaxonomy(taxonomy);
    const genres = deriveStoredGenres(taxonomy);
    const updated = await client.query(
      `UPDATE albums
       SET album_taxonomy = $1::jsonb,
           genre_1 = $2,
           genre_2 = $3,
           taxonomy_updated_at = NOW(),
           updated_at = NOW()
       WHERE album_id = $4
       RETURNING album_id, album_taxonomy, genre_1, genre_2, taxonomy_updated_at`,
      [JSON.stringify(taxonomy), genres.genre_1, genres.genre_2, albumId]
    );
    return formatMutationResult(updated.rows[0]);
  }

  async function runMutation(albumId, options, mutateTaxonomy) {
    if (typeof albumId !== 'string' || !albumId.trim()) {
      throw new TypeError('albumId is required');
    }
    if (options.client) {
      return updateLockedAlbum(options.client, albumId, mutateTaxonomy);
    }
    if (typeof db.withTransaction !== 'function') {
      throw new Error('album-taxonomy-service requires db.withTransaction');
    }
    return db.withTransaction((client) =>
      updateLockedAlbum(client, albumId, mutateTaxonomy)
    );
  }

  async function applyRymSnapshot(albumId, snapshot, options = {}) {
    if (snapshot === undefined) return null;
    const normalized = normalizeRymSnapshot(snapshot);
    const result = await runMutation(albumId, options, (taxonomy) => {
      taxonomy.rym = preserveOmittedRymFields(normalized, taxonomy.rym);
      reconcileLegacyOverrides(taxonomy, deriveGenreProjection(normalized));
    });
    log.info('Album RYM taxonomy snapshot applied', { albumId });
    return result;
  }

  async function applyManualGenreOverrides(albumId, overrides, options = {}) {
    if (overrides === undefined) return null;
    if (
      overrides !== null &&
      (typeof overrides !== 'object' || Array.isArray(overrides))
    ) {
      throw new TypeError('manual genre overrides must be an object or null');
    }
    if (
      options.updatedBy !== undefined &&
      options.updatedBy !== null &&
      typeof options.updatedBy !== 'string'
    ) {
      throw new TypeError('updatedBy must be a string or null');
    }

    const fields =
      overrides === null
        ? GENRE_FIELDS
        : GENRE_FIELDS.filter((field) => Object.hasOwn(overrides, field));
    if (fields.length === 0) return null;

    const normalized = Object.fromEntries(
      fields.map((field) => [
        field,
        overrides === null || overrides[field] === null
          ? null
          : normalizeTaxonomyTerm(overrides[field], field),
      ])
    );
    const result = await runMutation(albumId, options, (taxonomy) => {
      fields.forEach((field) => {
        const value = normalized[field];
        if (overrides === null) {
          delete taxonomy.manual_overrides[field];
          return;
        }
        taxonomy.manual_overrides[field] = {
          value: value || null,
          source: 'manual',
          updated_by: options.updatedBy ?? null,
          updated_at: new Date().toISOString(),
        };
      });
    });
    log.info('Album manual genre overrides applied', {
      albumId,
      fields,
      reset: fields.filter((field) => !normalized[field]),
    });
    return result;
  }

  function resetManualGenreOverrides(albumId, options = {}) {
    return applyManualGenreOverrides(albumId, null, options);
  }

  return {
    applyRymSnapshot,
    applyManualGenreOverrides,
    resetManualGenreOverrides,
    projectTaxonomyForRead,
  };
}

module.exports = {
  createAlbumTaxonomyService,
  projectTaxonomyForRead,
};
