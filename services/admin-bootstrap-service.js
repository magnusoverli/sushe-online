const { ensureDb } = require('../db/postgres');

function createDefaultAggregateStatus() {
  return {
    exists: false,
    revealed: false,
    locked: false,
    confirmations: [],
    confirmationCount: 0,
    requiredConfirmations: 2,
  };
}

function createAdminBootstrapService(deps = {}) {
  const db = ensureDb(deps.db, 'AdminBootstrapService');

  async function getAggregateStatuses(years) {
    if (!Array.isArray(years) || years.length === 0) {
      return new Map();
    }

    const [masterListsResult, confirmationsResult] = await Promise.all([
      db.raw(
        `SELECT year, revealed, revealed_at, computed_at, COALESCE(locked, FALSE) AS locked, stats
         FROM master_lists
         WHERE year = ANY($1::int[])`,
        [years]
      ),
      db.raw(
        `SELECT c.year, c.confirmed_at, u.username
         FROM master_list_confirmations c
         JOIN users u ON c.admin_user_id = u._id
         WHERE c.year = ANY($1::int[])
         ORDER BY c.year, c.confirmed_at`,
        [years]
      ),
    ]);

    const confirmationsByYear = new Map();
    for (const row of confirmationsResult.rows) {
      const list = confirmationsByYear.get(row.year) || [];
      list.push({ username: row.username, confirmedAt: row.confirmed_at });
      confirmationsByYear.set(row.year, list);
    }

    const statusByYear = new Map();
    for (const row of masterListsResult.rows) {
      const confirmations = confirmationsByYear.get(row.year) || [];
      const rawStats = row.stats || null;
      statusByYear.set(row.year, {
        exists: true,
        revealed: row.revealed,
        revealedAt: row.revealed_at,
        computedAt: row.computed_at,
        locked: row.locked,
        totalAlbums: rawStats?.totalAlbums || 0,
        rankDistribution: rawStats?.rankDistribution || {},
        confirmations,
        confirmationCount: confirmations.length,
        requiredConfirmations: 2,
        rawStats,
      });
    }

    for (const year of years) {
      if (!statusByYear.has(year)) {
        statusByYear.set(year, createDefaultAggregateStatus());
      }
    }

    return statusByYear;
  }

  async function getRecommendationStatuses(years, userId) {
    if (!Array.isArray(years) || years.length === 0) {
      return new Map();
    }

    const [
      settingsResult,
      accessCountResult,
      userAccessResult,
      recCountResult,
    ] = await Promise.all([
      db.raw(
        `SELECT year, locked
           FROM recommendation_settings
           WHERE year = ANY($1::int[])`,
        [years]
      ),
      db.raw(
        `SELECT year, COUNT(*)::int AS count
           FROM recommendation_access
           WHERE year = ANY($1::int[])
           GROUP BY year`,
        [years]
      ),
      db.raw(
        `SELECT year
           FROM recommendation_access
           WHERE year = ANY($1::int[])
             AND user_id = $2`,
        [years, userId]
      ),
      db.raw(
        `SELECT year, COUNT(*)::int AS count
           FROM recommendations
           WHERE year = ANY($1::int[])
           GROUP BY year`,
        [years]
      ),
    ]);

    const lockedByYear = new Map(
      settingsResult.rows.map((row) => [row.year, row.locked === true])
    );
    const accessCountByYear = new Map(
      accessCountResult.rows.map((row) => [row.year, row.count])
    );
    const userAccessYears = new Set(
      userAccessResult.rows.map((row) => row.year)
    );
    const recommendationCountByYear = new Map(
      recCountResult.rows.map((row) => [row.year, row.count])
    );

    const recommendationStatusByYear = new Map();
    for (const year of years) {
      const accessCount = accessCountByYear.get(year) || 0;
      recommendationStatusByYear.set(year, {
        year,
        locked: lockedByYear.get(year) || false,
        hasAccess: accessCount === 0 || userAccessYears.has(year),
        count: recommendationCountByYear.get(year) || 0,
      });
    }

    return recommendationStatusByYear;
  }

  return {
    createDefaultAggregateStatus,
    getAggregateStatuses,
    getRecommendationStatuses,
  };
}

module.exports = {
  createAdminBootstrapService,
  createDefaultAggregateStatus,
};
