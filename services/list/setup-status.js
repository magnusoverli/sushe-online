function createSetupStatus(deps = {}) {
  const { pool } = deps;
  // Prefer the canonical db; fall back to a pool adapter for legacy callers.
  const db =
    deps.db ||
    deps.listsAsync || // long-standing dep name honored for callers mid-migration
    (pool ? { raw: (sql, params) => pool.query(sql, params) } : null);
  if (!db) {
    throw new Error('setup-status requires deps.db (or legacy deps.pool)');
  }

  async function getSetupStatus(userId, user) {
    const result = await db.raw(
      `SELECT l._id, l.name, l.year, l.is_main, l.group_id, g.year as group_year
       FROM lists l
       LEFT JOIN list_groups g ON l.group_id = g.id
       WHERE l.user_id = $1`,
      [userId],
      { name: 'setup-status-user-lists', retryable: true }
    );

    const listRows = result.rows;

    const listsWithoutYear = listRows.filter(
      (list) =>
        list.year === null && list.group_id !== null && list.group_year !== null
    );
    const yearsWithLists = [
      ...new Set(
        listRows.filter((list) => list.year !== null).map((list) => list.year)
      ),
    ];

    const yearsWithMainList = listRows
      .filter((list) => list.is_main && list.year !== null)
      .map((list) => list.year);

    const yearsNeedingMain = yearsWithLists.filter(
      (year) => !yearsWithMainList.includes(year)
    );

    const needsSetup =
      listsWithoutYear.length > 0 || yearsNeedingMain.length > 0;

    return {
      needsSetup,
      listsWithoutYear: listsWithoutYear.map((list) => ({
        id: list._id,
        name: list.name,
      })),
      yearsNeedingMain,
      yearsSummary: yearsWithLists.map((year) => ({
        year,
        hasMain: yearsWithMainList.includes(year),
        lists: listRows
          .filter((list) => list.year === year)
          .map((list) => ({
            id: list._id,
            name: list.name,
            isMain: list.is_main,
          })),
      })),
      dismissedUntil: user.listSetupDismissedUntil || null,
    };
  }

  return {
    getSetupStatus,
  };
}

module.exports = {
  createSetupStatus,
};
