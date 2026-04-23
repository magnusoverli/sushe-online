function createAggregateListHandlers(deps = {}) {
  const { aggregateList, logger, scheduleAggregateRecompute } = deps;

  function renderPage(req, res, aggregateListTemplate) {
    res.send(aggregateListTemplate(req.user, req.validatedYear));
  }

  async function getAggregateList(req, res) {
    const year = req.validatedYear;
    const record = await aggregateList.get(year);

    if (!record) {
      return res
        .status(404)
        .json({ error: 'Aggregate list not found for this year' });
    }

    if (!record.revealed) {
      return res.status(403).json({
        error: 'Aggregate list has not been revealed yet',
        status: await aggregateList.getStatus(year),
      });
    }

    res.json({
      year,
      revealed: true,
      revealedAt: record.revealed_at,
      data: record.data,
    });
  }

  async function getStatus(req, res) {
    const year = req.validatedYear;
    const status = await aggregateList.getStatus(year);
    res.json(status);
  }

  async function getStats(req, res) {
    const year = req.validatedYear;

    let record = await aggregateList.get(year);
    if (!record) {
      await aggregateList.recompute(year);
      record = await aggregateList.get(year);
    }

    if (!record) {
      return res
        .status(404)
        .json({ error: 'No main lists found for this year' });
    }

    res.json({
      year,
      revealed: record.revealed,
      stats: record.stats,
    });
  }

  async function addConfirmation(req, res) {
    const year = req.validatedYear;
    const result = await aggregateList.addConfirmation(year, req.user._id);

    if (result.alreadyRevealed) {
      return res.status(400).json({
        error: 'Aggregate list has already been revealed',
        status: result.status,
      });
    }

    res.json({
      success: true,
      revealed: result.revealed,
      status: result.status,
    });
  }

  async function removeConfirmation(req, res) {
    const year = req.validatedYear;
    const result = await aggregateList.removeConfirmation(year, req.user._id);

    if (result.alreadyRevealed) {
      return res.status(400).json({
        error:
          'Cannot revoke confirmation - aggregate list has already been revealed',
        status: result.status,
      });
    }

    res.json({
      success: true,
      status: result.status,
    });
  }

  async function getRevealedYears(req, res) {
    const years = await aggregateList.getRevealedYears();
    res.json({ years });
  }

  async function getYearsWithMainLists(req, res) {
    const years = await aggregateList.getYearsWithMainLists();
    res.json({ years });
  }

  async function recompute(req, res) {
    const year = req.validatedYear;
    await aggregateList.recompute(year);
    const status = await aggregateList.getStatus(year);

    res.json({
      success: true,
      message: `Aggregate list for ${year} recomputed`,
      status,
    });
  }

  async function hasSeen(req, res) {
    const year = req.validatedYear;
    const hasSeenValue = await aggregateList.hasSeen(year, req.user._id);
    res.json({ hasSeen: hasSeenValue, year });
  }

  async function markSeen(req, res) {
    const year = req.validatedYear;
    await aggregateList.markSeen(year, req.user._id);
    res.json({ success: true, year });
  }

  async function resetSeen(req, res) {
    const year = req.validatedYear;
    const result = await aggregateList.resetSeen(year, req.user._id);
    res.json({
      success: true,
      deleted: result.deleted,
      message: result.deleted
        ? `Reveal view status reset for ${year}`
        : 'No view record found to reset',
    });
  }

  async function getViewedYears(req, res) {
    const viewedYears = await aggregateList.getViewedYears(req.user._id);
    res.json({ viewedYears });
  }

  async function getContributors(req, res) {
    const year = req.validatedYear;
    const contributors = await aggregateList.getContributors(year);
    res.json({ year, contributors });
  }

  async function getEligibleUsers(req, res) {
    const year = req.validatedYear;
    const eligibleUsers = await aggregateList.getEligibleUsers(year);
    res.json({ year, eligibleUsers });
  }

  async function addContributor(req, res) {
    const year = req.validatedYear;

    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    await aggregateList.addContributor(year, userId, req.user._id);
    scheduleAggregateRecompute(year, 'add_contributor');

    res.json({
      success: true,
      message: `User added as contributor for ${year}`,
      recomputeScheduled: true,
    });
  }

  async function removeContributor(req, res) {
    const year = req.validatedYear;

    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const result = await aggregateList.removeContributor(year, userId);
    scheduleAggregateRecompute(year, 'remove_contributor');

    res.json({
      success: true,
      removed: result.removed,
      recomputeScheduled: true,
      message: result.removed
        ? `User removed as contributor for ${year}`
        : 'User was not a contributor',
    });
  }

  async function setContributors(req, res) {
    const year = req.validatedYear;
    const { userIds } = req.body;
    if (!Array.isArray(userIds)) {
      return res.status(400).json({ error: 'userIds must be an array' });
    }

    await aggregateList.setContributors(year, userIds, req.user._id);
    scheduleAggregateRecompute(year, 'set_contributors');

    res.json({
      success: true,
      count: userIds.length,
      recomputeScheduled: true,
      message: `Set ${userIds.length} contributors for ${year}`,
    });
  }

  async function lockYear(req, res) {
    const year = req.validatedYear;
    await aggregateList.lockYear(year);

    logger.info('Admin action', {
      action: 'lock_year',
      adminId: req.user._id,
      adminEmail: req.user.email,
      year,
      ip: req.ip,
    });

    res.json({ success: true, year, locked: true });
  }

  async function unlockYear(req, res) {
    const year = req.validatedYear;
    await aggregateList.unlockYear(year);

    logger.info('Admin action', {
      action: 'unlock_year',
      adminId: req.user._id,
      adminEmail: req.user.email,
      year,
      ip: req.ip,
    });

    res.json({ success: true, year, locked: false });
  }

  async function getLockedYears(req, res) {
    const years = await aggregateList.getLockedYears();
    res.json({ years });
  }

  return {
    addConfirmation,
    addContributor,
    getAggregateList,
    getContributors,
    getEligibleUsers,
    getLockedYears,
    getRevealedYears,
    getStats,
    getStatus,
    getViewedYears,
    getYearsWithMainLists,
    hasSeen,
    lockYear,
    markSeen,
    recompute,
    removeConfirmation,
    removeContributor,
    renderPage,
    resetSeen,
    setContributors,
    unlockYear,
  };
}

module.exports = {
  createAggregateListHandlers,
};
