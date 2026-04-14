function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function createSettingsHandlers(deps = {}) {
  const { asyncHandler, userService, saveSessionSafe } = deps;

  function settingsHandler(field) {
    return asyncHandler(async (req, res) => {
      const value = req.body[field];
      const validation = userService.validateSetting(field, value);

      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      await userService.updateSetting(req.user._id, field, validation.value);

      req.user[field] = validation.value;
      saveSessionSafe(req, `${field} update`);
      res.json({ success: true });
    }, `updating ${field}`);
  }

  function uniqueFieldHandler(field, validator, validationError) {
    return asyncHandler(async (req, res) => {
      const value = req.body[field];

      if (!value || !value.trim()) {
        return res
          .status(400)
          .json({ error: `${capitalize(field)} is required` });
      }

      if (!validator(value)) {
        return res.status(400).json({ error: validationError });
      }

      const result = await userService.updateUniqueField(
        req.user._id,
        field,
        value
      );

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      req.user[field] = value.trim();
      saveSessionSafe(req, `${field} update`);
      req.flash('success', `${capitalize(field)} updated successfully`);
      res.json({ success: true });
    }, `updating ${field}`);
  }

  const updateLastSelectedList = asyncHandler(async (req, res) => {
    const listId = req.body.listId || req.body.listName;

    if (!listId) {
      return res.status(400).json({ error: 'listId is required' });
    }

    await userService.updateLastSelectedList(req.user._id, listId);

    req.user.lastSelectedList = listId;
    saveSessionSafe(req, 'lastSelectedList update');
    res.json({ success: true });
  }, 'updating last selected list');

  return {
    settingsHandler,
    uniqueFieldHandler,
    updateLastSelectedList,
  };
}

module.exports = {
  createSettingsHandlers,
};
