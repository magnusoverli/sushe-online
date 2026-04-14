function createTimeRangeHandler({
  getPreferences,
  field,
  queryParam,
  validValues,
  syncedAtField,
}) {
  return async (req, res) => {
    const userId = req.user._id;
    const filterValue = req.query[queryParam];
    const prefs = await getPreferences(userId);

    if (!prefs || !prefs[field]) {
      return res.json({
        success: true,
        data: filterValue ? [] : {},
      });
    }

    const data = prefs[field];

    if (filterValue && validValues.includes(filterValue)) {
      return res.json({
        success: true,
        data: data[filterValue] || [],
        [queryParam]: filterValue,
      });
    }

    res.json({
      success: true,
      data,
      syncedAt: prefs[syncedAtField],
    });
  };
}

function createAffinityHandler({ getPreferences, field }) {
  return async (req, res) => {
    const userId = req.user._id;
    const { limit = 50 } = req.query;
    const prefs = await getPreferences(userId);

    if (!prefs || !prefs[field]) {
      return res.json({
        success: true,
        data: [],
      });
    }

    const items = prefs[field] || [];
    const limitNum = Math.min(parseInt(limit, 10) || 50, 100);

    res.json({
      success: true,
      data: items.slice(0, limitNum),
      total: items.length,
      updatedAt: prefs.updated_at,
    });
  };
}

module.exports = {
  createAffinityHandler,
  createTimeRangeHandler,
};
