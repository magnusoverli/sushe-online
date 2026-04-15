/**
 * Duplicate Service
 *
 * Business logic for duplicate album detection and merging:
 * - Scan all albums for fuzzy-match duplicates
 * - Build duplicate clusters for admin review
 * - Smart-merge metadata from one album into another
 * - Reassign list_items safely (including same-list collisions)
 * - Clean up distinct pairs
 *
 * Follows dependency injection pattern for testability.
 */

const defaultLogger = require('../utils/logger');
const { withTransaction, TransactionAbort } = require('../db/transaction');
const {
  findPotentialDuplicates,
  normalizeForComparison,
} = require('../utils/fuzzy-match');

const DEFAULT_PAIR_LIMIT = 100;
const DEFAULT_CLUSTER_PAGE = 1;
const DEFAULT_CLUSTER_PAGE_SIZE = 25;
const MAX_CLUSTER_PAGE_SIZE = 100;

function clampNumber(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function hasText(value) {
  return normalizeText(value).length > 0;
}

function chooseBetterText(existing, incoming) {
  const current = normalizeText(existing);
  const candidate = normalizeText(incoming);

  if (!candidate) return current;
  if (!current) return candidate;
  if (candidate.length > current.length + 2) return candidate;
  return current;
}

function releaseDatePrecision(value) {
  const text = normalizeText(value);
  if (!text) return 0;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return 3;
  if (/^\d{4}-\d{2}$/.test(text)) return 2;
  if (/^\d{4}$/.test(text)) return 1;
  return 0;
}

function chooseBetterReleaseDate(existing, incoming) {
  const current = normalizeText(existing);
  const candidate = normalizeText(incoming);

  if (!candidate) return current;
  if (!current) return candidate;

  const currentPrecision = releaseDatePrecision(current);
  const candidatePrecision = releaseDatePrecision(candidate);

  if (candidatePrecision > currentPrecision) return candidate;
  if (candidatePrecision < currentPrecision) return current;
  return candidate.length > current.length ? candidate : current;
}

function collectUniqueTexts(values) {
  const deduped = [];
  const seen = new Set();

  for (const value of values) {
    const text = normalizeText(value);
    if (!text) continue;

    const key = text.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    deduped.push(text);
  }

  return deduped;
}

function parseTrackValue(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function coverSize(album) {
  const cover = album?.cover_image;
  if (!cover) return 0;
  if (Buffer.isBuffer(cover)) return cover.length;
  if (typeof cover === 'string') return Buffer.byteLength(cover, 'base64');
  return 0;
}

function mergeTextField(rows, fieldName) {
  const values = collectUniqueTexts(rows.map((row) => row[fieldName]));
  if (values.length === 0) return null;
  if (values.length === 1) return values[0];
  return values.join(' | ');
}

function mergeTrackSelections(rows) {
  const values = [];
  const seen = new Set();

  for (const row of rows) {
    for (const key of ['primary_track', 'secondary_track']) {
      const text = normalizeText(row[key]);
      if (!text) continue;

      const normalized = text.toLowerCase();
      if (seen.has(normalized)) continue;

      seen.add(normalized);
      values.push(text);

      if (values.length >= 2) {
        return {
          primaryTrack: values[0] || null,
          secondaryTrack: values[1] || null,
        };
      }
    }
  }

  return {
    primaryTrack: values[0] || null,
    secondaryTrack: values[1] || null,
  };
}

function listItemSortValue(row) {
  const position = Number.isFinite(row.position)
    ? row.position
    : Number.MAX_SAFE_INTEGER;
  const createdAt = row.created_at
    ? new Date(row.created_at).getTime()
    : Number.MAX_SAFE_INTEGER;
  return { position, createdAt };
}

function compareListItems(a, b) {
  const aSort = listItemSortValue(a);
  const bSort = listItemSortValue(b);

  if (aSort.position !== bSort.position) {
    return aSort.position - bSort.position;
  }

  if (aSort.createdAt !== bSort.createdAt) {
    return aSort.createdAt - bSort.createdAt;
  }

  return String(a._id).localeCompare(String(b._id));
}

function canonicalScore(album) {
  let score = 0;

  if (album.album_id && !album.album_id.startsWith('internal-')) score += 50;
  if (album.hasCover) score += 20;
  score += Math.min(30, album.trackCount || 0);
  score += Math.min(15, album.listRefs || 0);

  const datePrecision = releaseDatePrecision(album.release_date);
  if (datePrecision > 0) score += datePrecision * 3;

  if (hasText(album.genre_1)) score += 4;
  if (hasText(album.genre_2)) score += 2;
  if (hasText(album.summary)) score += 3;

  score += normalizeText(album.artist).length * 0.05;
  score += normalizeText(album.album).length * 0.05;

  return score;
}

function compareCanonicalAlbums(a, b) {
  if (a.canonicalScore !== b.canonicalScore) {
    return b.canonicalScore - a.canonicalScore;
  }

  if ((a.listRefs || 0) !== (b.listRefs || 0)) {
    return (b.listRefs || 0) - (a.listRefs || 0);
  }

  if ((a.trackCount || 0) !== (b.trackCount || 0)) {
    return (b.trackCount || 0) - (a.trackCount || 0);
  }

  const aCreatedAt = a.created_at
    ? new Date(a.created_at).getTime()
    : Number.MAX_SAFE_INTEGER;
  const bCreatedAt = b.created_at
    ? new Date(b.created_at).getTime()
    : Number.MAX_SAFE_INTEGER;

  if (aCreatedAt !== bCreatedAt) {
    return aCreatedAt - bCreatedAt;
  }

  return String(a.album_id).localeCompare(String(b.album_id));
}

/**
 * Create duplicate service with injected dependencies
 * @param {Object} deps
 * @param {Object} deps.pool - PostgreSQL pool
 * @param {Object} deps.logger - Logger instance
 */
// eslint-disable-next-line max-lines-per-function -- Cohesive service module with related duplicate operations
function createDuplicateService(deps = {}) {
  const pool = deps.pool;
  const logger = deps.logger || defaultLogger;

  function getBlockingKeys(album) {
    const normalizedArtist = normalizeForComparison(album.artist || '');
    const normalizedAlbum = normalizeForComparison(album.album || '');
    const artistTokens = normalizedArtist.split(' ').filter(Boolean);
    const albumTokens = normalizedAlbum.split(' ').filter(Boolean);

    const keys = new Set();
    const artistFirstChar = normalizedArtist.charAt(0);
    const albumFirstChar = normalizedAlbum.charAt(0);
    const artistFirstToken = artistTokens[0] || '';
    const albumFirstToken = albumTokens[0] || '';

    if (artistFirstChar) keys.add(`artist1:${artistFirstChar}`);
    if (albumFirstChar) keys.add(`album1:${albumFirstChar}`);

    if (artistFirstChar && albumFirstChar) {
      keys.add(`pair1:${artistFirstChar}|${albumFirstChar}`);
    }

    if (artistFirstToken) {
      keys.add(`artist3:${artistFirstToken.slice(0, 3)}`);
    }

    if (albumFirstToken) {
      keys.add(`album3:${albumFirstToken.slice(0, 3)}`);
    }

    if (artistFirstToken && albumFirstToken) {
      keys.add(
        `pair3:${artistFirstToken.slice(0, 3)}|${albumFirstToken.slice(0, 3)}`
      );
    }

    return [...keys];
  }

  function buildBlockingBuckets(albums) {
    const buckets = new Map();

    for (let i = 0; i < albums.length; i++) {
      const keys = getBlockingKeys(albums[i]);

      for (const key of keys) {
        if (!buckets.has(key)) {
          buckets.set(key, []);
        }

        buckets.get(key).push(i);
      }
    }

    return buckets;
  }

  function getCandidateIndexes(index, album, buckets, totalAlbums) {
    const candidateIndexes = new Set();
    const keys = getBlockingKeys(album);

    for (const key of keys) {
      const bucket = buckets.get(key) || [];

      for (const candidateIndex of bucket) {
        if (candidateIndex > index) {
          candidateIndexes.add(candidateIndex);
        }
      }
    }

    if (candidateIndexes.size === 0) {
      const fallbackWindow = Math.min(totalAlbums, index + 201);
      for (let i = index + 1; i < fallbackWindow; i++) {
        candidateIndexes.add(i);
      }
    }

    return [...candidateIndexes].sort((a, b) => a - b);
  }

  function buildDuplicateClusters(duplicatePairs) {
    if (duplicatePairs.length === 0) return [];

    const adjacency = new Map();
    const albumById = new Map();
    const pairIndexesById = new Map();

    const ensureNode = (album) => {
      if (!adjacency.has(album.album_id)) {
        adjacency.set(album.album_id, new Set());
      }
      if (!pairIndexesById.has(album.album_id)) {
        pairIndexesById.set(album.album_id, new Set());
      }
      if (!albumById.has(album.album_id)) {
        albumById.set(album.album_id, album);
      }
    };

    duplicatePairs.forEach((pair, index) => {
      ensureNode(pair.album1);
      ensureNode(pair.album2);

      adjacency.get(pair.album1.album_id).add(pair.album2.album_id);
      adjacency.get(pair.album2.album_id).add(pair.album1.album_id);

      pairIndexesById.get(pair.album1.album_id).add(index);
      pairIndexesById.get(pair.album2.album_id).add(index);
    });

    const clusters = [];
    const visited = new Set();

    for (const albumId of adjacency.keys()) {
      if (visited.has(albumId)) continue;

      const memberIds = [];
      const queue = [albumId];
      visited.add(albumId);

      while (queue.length > 0) {
        const current = queue.shift();
        memberIds.push(current);

        for (const neighbor of adjacency.get(current) || []) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }

      if (memberIds.length < 2) continue;

      const memberSet = new Set(memberIds);
      const pairIndexes = new Set();

      for (const id of memberIds) {
        for (const pairIndex of pairIndexesById.get(id) || []) {
          pairIndexes.add(pairIndex);
        }
      }

      const clusterPairs = [...pairIndexes]
        .map((pairIndex) => duplicatePairs[pairIndex])
        .filter(
          (pair) =>
            memberSet.has(pair.album1.album_id) &&
            memberSet.has(pair.album2.album_id)
        )
        .sort((a, b) => b.confidence - a.confidence);

      const members = memberIds
        .map((id) => ({
          ...albumById.get(id),
          canonicalScore: canonicalScore(albumById.get(id)),
        }))
        .sort(compareCanonicalAlbums);

      const confidenceValues = clusterPairs.map((pair) => pair.confidence);
      const maxConfidence = confidenceValues.length
        ? Math.max(...confidenceValues)
        : 0;
      const minConfidence = confidenceValues.length
        ? Math.min(...confidenceValues)
        : 0;
      const avgConfidence = confidenceValues.length
        ? Math.round(
            confidenceValues.reduce((sum, value) => sum + value, 0) /
              confidenceValues.length
          )
        : 0;

      const suggestedCanonicalId = members[0].album_id;
      const clusterId = `${suggestedCanonicalId}::${memberIds.length}`;

      clusters.push({
        clusterId,
        memberCount: members.length,
        suggestedCanonicalId,
        maxConfidence,
        minConfidence,
        avgConfidence,
        members,
        pairs: clusterPairs.map((pair) => ({
          album1Id: pair.album1.album_id,
          album2Id: pair.album2.album_id,
          confidence: pair.confidence,
          artistScore: pair.artistScore,
          albumScore: pair.albumScore,
        })),
      });
    }

    clusters.sort((a, b) => {
      if (a.maxConfidence !== b.maxConfidence) {
        return b.maxConfidence - a.maxConfidence;
      }
      if (a.memberCount !== b.memberCount) {
        return b.memberCount - a.memberCount;
      }
      return a.suggestedCanonicalId.localeCompare(b.suggestedCanonicalId);
    });

    return clusters;
  }

  function buildMergeFields(keepAlbum, deleteAlbum) {
    const fieldsToMerge = [];
    const fieldNames = [];
    const values = [keepAlbum.album_id];
    const nextParam = () => `$${values.length + 1}`;

    const pushField = (fieldName, value) => {
      fieldsToMerge.push(`${fieldName} = ${nextParam()}`);
      fieldNames.push(fieldName);
      values.push(value);
    };

    const bestArtist = chooseBetterText(keepAlbum.artist, deleteAlbum.artist);
    if (normalizeText(bestArtist) !== normalizeText(keepAlbum.artist)) {
      pushField('artist', bestArtist);
    }

    const bestAlbum = chooseBetterText(keepAlbum.album, deleteAlbum.album);
    if (normalizeText(bestAlbum) !== normalizeText(keepAlbum.album)) {
      pushField('album', bestAlbum);
    }

    const bestReleaseDate = chooseBetterReleaseDate(
      keepAlbum.release_date,
      deleteAlbum.release_date
    );
    if (
      normalizeText(bestReleaseDate) !== normalizeText(keepAlbum.release_date)
    ) {
      pushField('release_date', bestReleaseDate);
    }

    const bestCountry = chooseBetterText(
      keepAlbum.country,
      deleteAlbum.country
    );
    if (normalizeText(bestCountry) !== normalizeText(keepAlbum.country)) {
      pushField('country', bestCountry);
    }

    const mergedGenres = collectUniqueTexts([
      keepAlbum.genre_1,
      keepAlbum.genre_2,
      deleteAlbum.genre_1,
      deleteAlbum.genre_2,
    ]).slice(0, 2);

    const mergedGenre1 = mergedGenres[0] || normalizeText(keepAlbum.genre_1);
    const mergedGenre2 = mergedGenres[1] || normalizeText(keepAlbum.genre_2);

    if (normalizeText(mergedGenre1) !== normalizeText(keepAlbum.genre_1)) {
      pushField('genre_1', mergedGenre1);
    }
    if (normalizeText(mergedGenre2) !== normalizeText(keepAlbum.genre_2)) {
      pushField('genre_2', mergedGenre2);
    }

    const keepTracks = parseTrackValue(keepAlbum.tracks);
    const deleteTracks = parseTrackValue(deleteAlbum.tracks);
    const keepTrackCount = keepTracks ? keepTracks.length : 0;
    const deleteTrackCount = deleteTracks ? deleteTracks.length : 0;

    if (deleteTrackCount > keepTrackCount) {
      pushField('tracks', JSON.stringify(deleteTracks));
    }

    const keepCoverSize = coverSize(keepAlbum);
    const deleteCoverSize = coverSize(deleteAlbum);

    if (deleteCoverSize > keepCoverSize) {
      pushField('cover_image', deleteAlbum.cover_image);
      pushField('cover_image_format', deleteAlbum.cover_image_format || 'jpeg');
    }

    const keepSummary = normalizeText(keepAlbum.summary);
    const deleteSummary = normalizeText(deleteAlbum.summary);
    if (deleteSummary && deleteSummary.length > keepSummary.length) {
      pushField('summary', deleteAlbum.summary);
      pushField('summary_source', deleteAlbum.summary_source);
      pushField('summary_fetched_at', deleteAlbum.summary_fetched_at);
    }

    return { fieldsToMerge, fieldNames, values };
  }

  function applyMergeFieldValues(album, fieldNames, values) {
    const nextAlbum = { ...album };

    for (let i = 0; i < fieldNames.length; i++) {
      const fieldName = fieldNames[i];
      const rawValue = values[i + 1];

      if (fieldName === 'tracks') {
        nextAlbum[fieldName] = parseTrackValue(rawValue);
      } else {
        nextAlbum[fieldName] = rawValue;
      }
    }

    return nextAlbum;
  }

  async function resolveListItemCollisions(client, keepAlbumId, deleteAlbumId) {
    const rowsResult = await client.query(
      `SELECT _id, list_id, album_id, position, comments, comments_2,
              primary_track, secondary_track, created_at
       FROM list_items
       WHERE album_id = $1 OR album_id = $2
       ORDER BY list_id, position ASC, created_at ASC`,
      [keepAlbumId, deleteAlbumId]
    );

    const rowsByListId = new Map();

    for (const row of rowsResult.rows) {
      if (!rowsByListId.has(row.list_id)) {
        rowsByListId.set(row.list_id, []);
      }
      rowsByListId.get(row.list_id).push(row);
    }

    let collisionsResolved = 0;
    let rowsUpdated = 0;
    let rowsDeleted = 0;

    for (const listRows of rowsByListId.values()) {
      const hasKeep = listRows.some((row) => row.album_id === keepAlbumId);
      const hasDelete = listRows.some((row) => row.album_id === deleteAlbumId);

      if (!hasKeep || !hasDelete) continue;

      collisionsResolved++;

      const sortedRows = [...listRows].sort(compareListItems);
      const baseRow = sortedRows[0];
      const otherRows = sortedRows.slice(1);

      const numericPositions = sortedRows
        .map((row) => row.position)
        .filter((value) => Number.isFinite(value));

      const mergedPosition =
        numericPositions.length > 0
          ? Math.min(...numericPositions)
          : baseRow.position;
      const mergedComments = mergeTextField(sortedRows, 'comments');
      const mergedComments2 = mergeTextField(sortedRows, 'comments_2');
      const mergedTracks = mergeTrackSelections(sortedRows);

      await client.query(
        `UPDATE list_items
         SET album_id = $1,
             position = $2,
             comments = $3,
             comments_2 = $4,
             primary_track = $5,
             secondary_track = $6,
             updated_at = NOW()
         WHERE _id = $7`,
        [
          keepAlbumId,
          mergedPosition,
          mergedComments,
          mergedComments2,
          mergedTracks.primaryTrack,
          mergedTracks.secondaryTrack,
          baseRow._id,
        ]
      );
      rowsUpdated++;

      const deleteIds = otherRows.map((row) => row._id);
      if (deleteIds.length > 0) {
        const deleteResult = await client.query(
          `DELETE FROM list_items WHERE _id = ANY($1::text[])`,
          [deleteIds]
        );
        rowsDeleted += deleteResult.rowCount;
      }
    }

    return {
      collisionsResolved,
      rowsUpdated,
      rowsDeleted,
    };
  }

  async function mergeAlbumsWithinTransaction(
    client,
    keepAlbumId,
    deleteAlbumId
  ) {
    const albumsResult = await client.query(
      `SELECT album_id, artist, album, release_date, country,
              genre_1, genre_2, tracks, cover_image, cover_image_format,
              summary, summary_source, summary_fetched_at
       FROM albums WHERE album_id = $1 OR album_id = $2`,
      [keepAlbumId, deleteAlbumId]
    );

    const keepAlbum = albumsResult.rows.find((a) => a.album_id === keepAlbumId);
    const deleteAlbum = albumsResult.rows.find(
      (a) => a.album_id === deleteAlbumId
    );

    if (!keepAlbum) {
      throw new TransactionAbort(404, { error: 'Keep album not found' });
    }

    let metadataMerged = false;
    let mergedFieldNames = [];

    if (deleteAlbum) {
      const { fieldsToMerge, fieldNames, values } = buildMergeFields(
        keepAlbum,
        deleteAlbum
      );

      if (fieldsToMerge.length > 0) {
        fieldsToMerge.push('updated_at = NOW()');
        await client.query(
          `UPDATE albums SET ${fieldsToMerge.join(', ')} WHERE album_id = $1`,
          values
        );
        metadataMerged = true;
        mergedFieldNames = fieldNames;
      }
    }

    const collisionStats = await resolveListItemCollisions(
      client,
      keepAlbumId,
      deleteAlbumId
    );

    const updateResult = await client.query(
      `UPDATE list_items SET album_id = $1, updated_at = NOW() WHERE album_id = $2`,
      [keepAlbumId, deleteAlbumId]
    );

    const deleteResult = await client.query(
      `DELETE FROM albums WHERE album_id = $1`,
      [deleteAlbumId]
    );

    await client.query(
      `DELETE FROM album_distinct_pairs WHERE album_id_1 = $1 OR album_id_2 = $1`,
      [deleteAlbumId]
    );

    const listItemsUpdated = updateResult.rowCount + collisionStats.rowsUpdated;

    logger.info('Albums merged successfully', {
      keepAlbumId,
      deleteAlbumId,
      listItemsUpdated,
      albumsDeleted: deleteResult.rowCount,
      metadataMerged,
      mergedFieldCount: mergedFieldNames.length,
      collisionsResolved: collisionStats.collisionsResolved,
      collisionRowsDeleted: collisionStats.rowsDeleted,
    });

    return {
      listItemsUpdated,
      albumsDeleted: deleteResult.rowCount,
      metadataMerged,
      mergedFieldNames,
      collisionsResolved: collisionStats.collisionsResolved,
      collisionRowsDeleted: collisionStats.rowsDeleted,
    };
  }

  function normalizeRetireAlbumIds(canonicalAlbumId, retireAlbumIds) {
    if (!Array.isArray(retireAlbumIds)) {
      throw new TransactionAbort(400, {
        error: 'retireAlbumIds must be an array',
      });
    }

    const cleaned = [];
    const seen = new Set();

    for (const albumId of retireAlbumIds) {
      const value = normalizeText(albumId);
      if (!value || value === canonicalAlbumId || seen.has(value)) continue;
      seen.add(value);
      cleaned.push(value);
    }

    if (cleaned.length === 0) {
      throw new TransactionAbort(400, {
        error: 'At least one retire album ID is required',
      });
    }

    return cleaned;
  }

  /**
   * Scan all albums for potential fuzzy-match duplicates.
   *
   * @param {number} threshold - Similarity threshold (0.03–0.5, default 0.15)
   * @param {Object} options - Pagination options for clusters
   * @returns {Promise<Object>} scan result with pairs and clusters
   */
  async function scanDuplicates(threshold, options = {}) {
    const clampedThreshold = Math.max(
      0.03,
      Math.min(0.5, parseFloat(threshold) || 0.15)
    );

    const page = clampNumber(
      options.page,
      1,
      Number.MAX_SAFE_INTEGER,
      DEFAULT_CLUSTER_PAGE
    );
    const pageSize = clampNumber(
      options.pageSize,
      1,
      MAX_CLUSTER_PAGE_SIZE,
      DEFAULT_CLUSTER_PAGE_SIZE
    );

    const albumsResult = await pool.query(`
      SELECT
        album_id,
        artist,
        album,
        release_date,
        country,
        genre_1,
        genre_2,
        tracks,
        summary,
        COALESCE(jsonb_array_length(tracks), 0) as track_count,
        cover_image IS NOT NULL as has_cover,
        created_at
      FROM albums
      WHERE artist IS NOT NULL AND artist != ''
        AND album IS NOT NULL AND album != ''
        AND album_id IS NOT NULL
      ORDER BY artist, album
    `);

    const excludedPairsResult = await pool.query(
      `SELECT album_id_1, album_id_2 FROM album_distinct_pairs`
    );

    const excludePairs = new Set();
    for (const row of excludedPairsResult.rows) {
      excludePairs.add(`${row.album_id_1}::${row.album_id_2}`);
      excludePairs.add(`${row.album_id_2}::${row.album_id_1}`);
    }

    const albums = albumsResult.rows.map((row) => ({
      album_id: row.album_id,
      artist: row.artist,
      album: row.album,
      release_date: row.release_date || null,
      country: row.country || null,
      genre_1: row.genre_1 || null,
      genre_2: row.genre_2 || null,
      tracks: parseTrackValue(row.tracks),
      summary: row.summary || null,
      trackCount: row.track_count > 0 ? row.track_count : null,
      hasCover: row.has_cover,
      created_at: row.created_at,
      listRefs: 0,
    }));

    if (albums.length > 0) {
      const albumIds = albums.map((album) => album.album_id);
      const refsResult = await pool.query(
        `SELECT album_id, COUNT(*)::int AS list_refs
         FROM list_items
         WHERE album_id = ANY($1::text[])
         GROUP BY album_id`,
        [albumIds]
      );

      const refsByAlbumId = new Map(
        refsResult.rows.map((row) => [row.album_id, row.list_refs])
      );

      for (const album of albums) {
        album.listRefs = refsByAlbumId.get(album.album_id) || 0;
      }
    }

    const blockingBuckets = buildBlockingBuckets(albums);

    const duplicatePairs = [];
    const processedPairs = new Set();
    const totalPossibleComparisons = (albums.length * (albums.length - 1)) / 2;
    let candidateComparisons = 0;

    for (let i = 0; i < albums.length; i++) {
      const album = albums[i];
      const candidateIndexes = getCandidateIndexes(
        i,
        album,
        blockingBuckets,
        albums.length
      );
      const candidates = candidateIndexes.map((candidateIndex) => {
        return albums[candidateIndex];
      });
      candidateComparisons += candidates.length;

      const matches = findPotentialDuplicates(album, candidates, {
        threshold: clampedThreshold,
        maxResults: 10,
        excludePairs,
      });

      for (const match of matches) {
        const pairKey = [album.album_id, match.candidate.album_id]
          .sort()
          .join('::');
        if (processedPairs.has(pairKey)) continue;

        processedPairs.add(pairKey);
        duplicatePairs.push({
          album1: album,
          album2: match.candidate,
          confidence: Math.round(match.confidence * 100),
          artistScore: Math.round(match.artistScore.score * 100),
          albumScore: Math.round(match.albumScore.score * 100),
        });
      }
    }

    duplicatePairs.sort((a, b) => b.confidence - a.confidence);

    const clusters = buildDuplicateClusters(duplicatePairs);
    const totalClusters = clusters.length;
    const clusterStart = (page - 1) * pageSize;
    const pagedClusters = clusters.slice(clusterStart, clusterStart + pageSize);

    logger.info('Duplicate scan completed', {
      totalAlbums: albums.length,
      potentialDuplicates: duplicatePairs.length,
      totalClusters,
      excludedPairs: excludePairs.size / 2,
      comparisonsEvaluated: candidateComparisons,
      totalPossibleComparisons,
      comparisonReductionPct:
        totalPossibleComparisons > 0
          ? Math.round(
              ((totalPossibleComparisons - candidateComparisons) /
                totalPossibleComparisons) *
                100
            )
          : 0,
    });

    return {
      totalAlbums: albums.length,
      potentialDuplicates: duplicatePairs.length,
      excludedPairs: excludePairs.size / 2,
      pairs: duplicatePairs.slice(0, DEFAULT_PAIR_LIMIT),
      clusters: pagedClusters,
      totalClusters,
      page,
      pageSize,
      hasMoreClusters: clusterStart + pageSize < totalClusters,
    };
  }

  /**
   * Merge two albums: keep one, transfer list_items, smart-merge metadata, delete the other.
   *
   * @param {string} keepAlbumId - Album ID to keep
   * @param {string} deleteAlbumId - Album ID to delete
   * @returns {Promise<Object>} merge result
   * @throws {TransactionAbort} on validation failure
   */
  async function mergeAlbums(keepAlbumId, deleteAlbumId) {
    if (!keepAlbumId || !deleteAlbumId) {
      throw new TransactionAbort(400, {
        error: 'keepAlbumId and deleteAlbumId are required',
      });
    }

    if (keepAlbumId === deleteAlbumId) {
      throw new TransactionAbort(400, {
        error: 'Cannot merge album with itself',
      });
    }

    return withTransaction(pool, async (client) => {
      return mergeAlbumsWithinTransaction(client, keepAlbumId, deleteAlbumId);
    });
  }

  /**
   * Preview the impact of merging a cluster into a canonical album.
   *
   * @param {string} canonicalAlbumId - Canonical album ID to keep
   * @param {string[]} retireAlbumIds - Album IDs to retire
   * @returns {Promise<Object>} dry-run impact summary
   */
  async function previewMergeCluster(canonicalAlbumId, retireAlbumIds) {
    const canonicalId = normalizeText(canonicalAlbumId);
    if (!canonicalId) {
      throw new TransactionAbort(400, {
        error: 'canonicalAlbumId is required',
      });
    }

    const retireIds = normalizeRetireAlbumIds(canonicalId, retireAlbumIds);
    const allIds = [canonicalId, ...retireIds];

    const albumsResult = await pool.query(
      `SELECT album_id, artist, album, release_date, country,
              genre_1, genre_2, tracks, cover_image, cover_image_format,
              summary, summary_source, summary_fetched_at
       FROM albums
       WHERE album_id = ANY($1::text[])`,
      [allIds]
    );

    const albumsById = new Map(
      albumsResult.rows.map((album) => [album.album_id, album])
    );
    const canonicalAlbum = albumsById.get(canonicalId);

    if (!canonicalAlbum) {
      throw new TransactionAbort(404, { error: 'Canonical album not found' });
    }

    const existingRetireIds = retireIds.filter((id) => albumsById.has(id));
    const missingRetireIds = retireIds.filter((id) => !albumsById.has(id));

    const impactedRowsResult = await pool.query(
      `SELECT li.list_id, li.album_id,
              l.name AS list_name, l.year,
              l.user_id, u.username
       FROM list_items li
       JOIN lists l ON li.list_id = l._id
       JOIN users u ON l.user_id = u._id
       WHERE li.album_id = ANY($1::text[])`,
      [allIds]
    );

    const impactedListIds = new Set();
    const impactedUserIds = new Set();
    const listInfoById = new Map();
    const listAlbumSets = new Map();

    for (const row of impactedRowsResult.rows) {
      impactedListIds.add(row.list_id);
      impactedUserIds.add(row.user_id);

      if (!listInfoById.has(row.list_id)) {
        listInfoById.set(row.list_id, {
          listId: row.list_id,
          listName: row.list_name,
          year: row.year,
          userId: row.user_id,
          username: row.username,
        });
      }

      if (!listAlbumSets.has(row.list_id)) {
        listAlbumSets.set(row.list_id, new Set());
      }
      listAlbumSets.get(row.list_id).add(row.album_id);
    }

    const collisions = [];
    for (const [listId, albumIds] of listAlbumSets.entries()) {
      if (albumIds.size < 2) continue;
      collisions.push({
        ...listInfoById.get(listId),
        albumIds: [...albumIds].sort(),
        variantCount: albumIds.size,
      });
    }

    const mergedFieldNames = new Set();
    let simulatedCanonical = { ...canonicalAlbum };

    for (const retireId of existingRetireIds) {
      const retireAlbum = albumsById.get(retireId);
      const mergePreview = buildMergeFields(simulatedCanonical, retireAlbum);

      for (const fieldName of mergePreview.fieldNames) {
        mergedFieldNames.add(fieldName);
      }

      simulatedCanonical = applyMergeFieldValues(
        simulatedCanonical,
        mergePreview.fieldNames,
        mergePreview.values
      );
    }

    return {
      canonicalAlbumId: canonicalId,
      retireAlbumIds: existingRetireIds,
      missingRetireAlbumIds: missingRetireIds,
      impactedLists: impactedListIds.size,
      impactedUsers: impactedUserIds.size,
      collisionCount: collisions.length,
      collisions: collisions.slice(0, 100),
      metadataFieldsLikelyMerged: [...mergedFieldNames].sort(),
    };
  }

  /**
   * Merge multiple albums into a canonical album in one transaction.
   *
   * @param {string} canonicalAlbumId - Album ID to keep
   * @param {string[]} retireAlbumIds - Album IDs to retire
   * @returns {Promise<Object>} aggregate merge result
   */
  async function mergeCluster(canonicalAlbumId, retireAlbumIds) {
    const canonicalId = normalizeText(canonicalAlbumId);
    if (!canonicalId) {
      throw new TransactionAbort(400, {
        error: 'canonicalAlbumId is required',
      });
    }

    const retireIds = normalizeRetireAlbumIds(canonicalId, retireAlbumIds);

    return withTransaction(pool, async (client) => {
      const aggregate = {
        canonicalAlbumId: canonicalId,
        requestedRetireIds: retireIds,
        mergedAlbums: 0,
        missingAlbums: 0,
        listItemsUpdated: 0,
        albumsDeleted: 0,
        metadataMerged: false,
        mergedFieldNames: new Set(),
        collisionsResolved: 0,
        collisionRowsDeleted: 0,
        results: [],
      };

      for (const retireId of retireIds) {
        const result = await mergeAlbumsWithinTransaction(
          client,
          canonicalId,
          retireId
        );

        aggregate.results.push({ retireAlbumId: retireId, ...result });
        aggregate.listItemsUpdated += result.listItemsUpdated;
        aggregate.albumsDeleted += result.albumsDeleted;
        aggregate.collisionsResolved += result.collisionsResolved;
        aggregate.collisionRowsDeleted += result.collisionRowsDeleted;

        if (result.albumsDeleted > 0) {
          aggregate.mergedAlbums++;
        } else {
          aggregate.missingAlbums++;
        }

        if (result.metadataMerged) {
          aggregate.metadataMerged = true;
        }

        for (const fieldName of result.mergedFieldNames || []) {
          aggregate.mergedFieldNames.add(fieldName);
        }
      }

      return {
        canonicalAlbumId: aggregate.canonicalAlbumId,
        requestedRetireIds: aggregate.requestedRetireIds,
        mergedAlbums: aggregate.mergedAlbums,
        missingAlbums: aggregate.missingAlbums,
        listItemsUpdated: aggregate.listItemsUpdated,
        albumsDeleted: aggregate.albumsDeleted,
        metadataMerged: aggregate.metadataMerged,
        mergedFieldNames: [...aggregate.mergedFieldNames].sort(),
        collisionsResolved: aggregate.collisionsResolved,
        collisionRowsDeleted: aggregate.collisionRowsDeleted,
        results: aggregate.results,
      };
    });
  }

  return {
    scanDuplicates,
    mergeAlbums,
    previewMergeCluster,
    mergeCluster,
  };
}

module.exports = { createDuplicateService };
