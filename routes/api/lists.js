/**
 * Lists API Routes
 *
 * Handles list management:
 * - Get all lists
 * - Get single list
 * - Create/update/delete lists
 * - Reorder list items
 * - Setup wizard
 * - Bulk operations
 */

/**
 * Register list routes
 * @param {Object} app - Express app instance
 * @param {Object} deps - Dependencies
 */
module.exports = (app, deps) => {
  const {
    ensureAuthAPI,
    pool,
    logger,
    lists,
    listsAsync,
    listItemsAsync,
    albumsAsync,
    cacheConfigs,
    responseCache,
    getPointsForPosition,
    crypto,
    validateYear,
    helpers: { triggerAggregateListRecompute, upsertAlbumRecord },
  } = deps;

  // Get all lists for current user
  app.get(
    '/api/lists',
    ensureAuthAPI,
    cacheConfigs.userSpecific,
    async (req, res) => {
      try {
        const userLists = await listsAsync.find({ userId: req.user._id });
        const { full } = req.query;

        const listsObj = {};

        if (full === 'true') {
          // FULL MODE: Return all album data (backward compatibility)
          if (typeof listsAsync.findAllUserListsWithItems === 'function') {
            const allRows = await listsAsync.findAllUserListsWithItems(
              req.user._id
            );

            // Group rows by list name
            for (const row of allRows) {
              if (!listsObj[row.list_name]) {
                listsObj[row.list_name] = [];
              }
              if (row.position !== null && row.item_id !== null) {
                listsObj[row.list_name].push({
                  _id: row.item_id, // List item ID for track picks API
                  artist: row.artist || '',
                  album: row.album || '',
                  album_id: row.album_id || '',
                  release_date: row.release_date || '',
                  country: row.country || '',
                  genre_1: row.genre_1 || '',
                  genre_2: row.genre_2 || '',
                  track_pick: row.primary_track || '', // Legacy: use primary_track as track_pick
                  primary_track: row.primary_track || null,
                  secondary_track: row.secondary_track || null,
                  comments: row.comments || '',
                  tracks: row.tracks || null,
                  cover_image: row.cover_image || '',
                  cover_image_format: row.cover_image_format || '',
                  summary: row.summary || '',
                  summary_source: row.summary_source || '',
                });
              }
            }

            // Ensure empty lists are included
            for (const list of userLists) {
              if (!listsObj[list.name]) {
                listsObj[list.name] = [];
              }
            }
          } else {
            // Fallback to original N+1 pattern
            for (const list of userLists) {
              const items = await listItemsAsync.find({ listId: list._id });
              items.sort((a, b) => a.position - b.position);

              const albumIds = items
                .map((item) => item.albumId)
                .filter(Boolean);
              const albumsData =
                albumIds.length > 0
                  ? await albumsAsync.findByAlbumIds(albumIds)
                  : [];
              const albumsMap = new Map(
                albumsData.map((album) => [album.albumId, album])
              );

              const mapped = [];
              for (const item of items) {
                const albumData = item.albumId
                  ? albumsMap.get(item.albumId)
                  : null;
                mapped.push({
                  _id: item._id, // List item ID for track picks API
                  artist: item.artist || albumData?.artist,
                  album: item.album || albumData?.album,
                  album_id: item.albumId,
                  release_date: item.releaseDate || albumData?.releaseDate,
                  country: item.country || albumData?.country,
                  genre_1: item.genre1 || albumData?.genre1,
                  genre_2: item.genre2 || albumData?.genre2,
                  track_pick: item.primaryTrack || '', // Legacy: use primaryTrack
                  primary_track: item.primaryTrack || null,
                  secondary_track: item.secondaryTrack || null,
                  comments: item.comments,
                  tracks: item.tracks || albumData?.tracks,
                  cover_image: item.coverImage || albumData?.coverImage,
                  cover_image_format:
                    item.coverImageFormat || albumData?.coverImageFormat,
                  summary: albumData?.summary || '',
                  summary_source: albumData?.summarySource || '',
                });
              }
              listsObj[list.name] = mapped;
            }
          }
        } else {
          // METADATA MODE (default): Return only list metadata for fast loading
          if (typeof listsAsync.findWithCounts === 'function') {
            const listsWithCounts = await listsAsync.findWithCounts({
              userId: req.user._id,
            });
            for (const list of listsWithCounts) {
              listsObj[list.name] = {
                _id: list._id,
                name: list.name,
                year: list.year || null,
                isMain: list.isMain || false,
                count: list.itemCount,
                groupId: list.group?._id || null,
                sortOrder: list.sortOrder || 0,
                updatedAt: list.updatedAt,
                createdAt: list.createdAt,
              };
            }
          } else {
            // Fallback to N+1 pattern
            for (const list of userLists) {
              const count = await listItemsAsync.count({ listId: list._id });
              listsObj[list.name] = {
                _id: list._id,
                name: list.name,
                year: list.year || null,
                isMain: list.isMain || false,
                count: count,
                groupId: list.groupId || null,
                sortOrder: list.sortOrder || 0,
                updatedAt: list.updatedAt,
                createdAt: list.createdAt,
              };
            }
          }
        }

        res.json(listsObj);
      } catch (err) {
        logger.error('Error fetching lists', {
          error: err.message,
          userId: req.user._id,
        });
        return res.status(500).json({ error: 'Error fetching lists' });
      }
    }
  );

  // Check if user needs to complete list setup (year assignment + main list designation)
  app.get('/api/lists/setup-status', ensureAuthAPI, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT l._id, l.name, l.year, l.is_main, l.group_id, g.year as group_year
         FROM lists l
         LEFT JOIN list_groups g ON l.group_id = g.id
         WHERE l.user_id = $1`,
        [req.user._id]
      );

      const listRows = result.rows;

      // Lists need year assignment ONLY if:
      // 1. The list has no year set (l.year === null)
      // 2. AND the list is in a group (l.group_id !== null)
      // 3. AND that group is a year-group (l.group_year !== null)
      //
      // This catches edge cases where a list is in a year-group but the year
      // wasn't synced. Lists in collections (groups without years) and orphaned
      // lists (no group - "Uncategorized") should NOT require year assignment.
      const listsWithoutYear = listRows.filter(
        (l) => l.year === null && l.group_id !== null && l.group_year !== null
      );
      const yearsWithLists = [
        ...new Set(listRows.filter((l) => l.year !== null).map((l) => l.year)),
      ];

      const yearsWithMainList = listRows
        .filter((l) => l.is_main && l.year !== null)
        .map((l) => l.year);

      const yearsNeedingMain = yearsWithLists.filter(
        (year) => !yearsWithMainList.includes(year)
      );

      const needsSetup =
        listsWithoutYear.length > 0 || yearsNeedingMain.length > 0;

      res.json({
        needsSetup,
        listsWithoutYear: listsWithoutYear.map((l) => ({
          id: l._id,
          name: l.name,
        })),
        yearsNeedingMain,
        yearsSummary: yearsWithLists.map((year) => ({
          year,
          hasMain: yearsWithMainList.includes(year),
          lists: listRows
            .filter((l) => l.year === year)
            .map((l) => ({
              id: l._id,
              name: l.name,
              isMain: l.is_main,
            })),
        })),
        dismissedUntil: req.user.listSetupDismissedUntil || null,
      });
    } catch (err) {
      logger.error('Error checking list setup status', {
        error: err.message,
        userId: req.user._id,
      });
      res.status(500).json({ error: 'Failed to check setup status' });
    }
  });

  // Bulk update lists (year assignment and main list designation)
  app.post('/api/lists/bulk-update', ensureAuthAPI, async (req, res) => {
    const { updates } = req.body;

    if (!Array.isArray(updates)) {
      return res.status(400).json({ error: 'Updates must be an array' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const results = [];
      const yearsToRecompute = new Set();

      for (const update of updates) {
        const { listId, year, isMain } = update;

        if (!listId) {
          results.push({ listId, success: false, error: 'Missing listId' });
          continue;
        }

        const listCheck = await client.query(
          'SELECT _id, year, is_main FROM lists WHERE _id = $1 AND user_id = $2',
          [listId, req.user._id]
        );

        if (listCheck.rows.length === 0) {
          results.push({ listId, success: false, error: 'List not found' });
          continue;
        }

        const oldList = listCheck.rows[0];
        const oldYear = oldList.year;
        const newYear = year !== undefined ? year : oldList.year;
        const newIsMain = isMain !== undefined ? isMain : oldList.is_main;

        if (newYear !== null && (newYear < 1000 || newYear > 9999)) {
          results.push({ listId, success: false, error: 'Invalid year' });
          continue;
        }

        if (newIsMain && newYear !== null) {
          await client.query(
            `UPDATE lists SET is_main = FALSE, updated_at = NOW() 
             WHERE user_id = $1 AND year = $2 AND is_main = TRUE AND _id != $3`,
            [req.user._id, newYear, listId]
          );
        }

        await client.query(
          `UPDATE lists SET year = $1, is_main = $2, updated_at = NOW() WHERE _id = $3`,
          [newYear, newIsMain, listId]
        );

        results.push({ listId, success: true });

        if (oldYear !== null) yearsToRecompute.add(oldYear);
        if (newYear !== null && newIsMain) yearsToRecompute.add(newYear);
      }

      await client.query('COMMIT');

      responseCache.invalidate(`GET:/api/lists:${req.user._id}`);

      for (const year of yearsToRecompute) {
        triggerAggregateListRecompute(year);
      }

      res.json({
        success: true,
        results,
        recomputingYears: [...yearsToRecompute],
      });
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('Error bulk updating lists', {
        error: err.message,
        userId: req.user._id,
      });
      res.status(500).json({ error: 'Failed to update lists' });
    } finally {
      client.release();
    }
  });

  // Dismiss list setup wizard (temporary)
  app.post('/api/lists/setup-dismiss', ensureAuthAPI, async (req, res) => {
    try {
      const dismissedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await pool.query(
        `UPDATE users SET list_setup_dismissed_until = $1 WHERE _id = $2`,
        [dismissedUntil, req.user._id]
      );

      res.json({ success: true, dismissedUntil });
    } catch (err) {
      logger.error('Error dismissing setup wizard', {
        error: err.message,
        userId: req.user._id,
      });
      res.status(500).json({ error: 'Failed to dismiss wizard' });
    }
  });

  // Get a single list
  app.get(
    '/api/lists/:name',
    ensureAuthAPI,
    cacheConfigs.userSpecific,
    async (req, res) => {
      try {
        const { name } = req.params;
        const isExport = req.query.export === 'true';
        logger.debug('Fetching list', {
          name,
          userId: req.user._id,
          isExport,
        });
        const list = await listsAsync.findOne({ userId: req.user._id, name });

        if (!list) {
          logger.warn('List not found', { name, userId: req.user._id });
          return res.status(404).json({ error: 'List not found' });
        }
        logger.debug('List found', { listId: list._id, name });

        const items = await listItemsAsync.findWithAlbumData(
          list._id,
          req.user._id
        );

        const data = items.map((item, index) => ({
          _id: item._id,
          artist: item.artist,
          album: item.album,
          album_id: item.albumId,
          release_date: item.releaseDate,
          country: item.country,
          genre_1: item.genre1,
          genre_2: item.genre2,
          track_pick: item.primaryTrack || '', // Legacy: use primaryTrack
          primary_track: item.primaryTrack || null,
          secondary_track: item.secondaryTrack || null,
          comments: item.comments,
          tracks: item.tracks,
          cover_image_format: item.coverImageFormat,
          summary: item.summary || '',
          summary_source: item.summarySource || '',
          ...(isExport
            ? {
                cover_image: item.coverImage
                  ? Buffer.isBuffer(item.coverImage)
                    ? item.coverImage.toString('base64')
                    : item.coverImage
                  : '',
                rank: index + 1,
                points: getPointsForPosition(index + 1),
              }
            : (() => {
                if (item.coverImage) {
                  return {
                    cover_image: Buffer.isBuffer(item.coverImage)
                      ? item.coverImage.toString('base64')
                      : item.coverImage,
                    cover_image_format: item.coverImageFormat || 'jpeg',
                  };
                } else if (item.albumId) {
                  return {
                    cover_image_url: `/api/albums/${item.albumId}/cover`,
                  };
                } else {
                  return {};
                }
              })()),
        }));

        if (isExport) {
          let groupInfo = null;
          if (list.groupId) {
            const groupResult = await pool.query(
              `SELECT _id, name, year FROM list_groups WHERE id = $1`,
              [list.groupId]
            );
            if (groupResult.rows.length > 0) {
              const group = groupResult.rows[0];
              groupInfo = {
                _id: group._id,
                name: group.name,
                year: group.year,
              };
            }
          }

          res.json({
            _metadata: {
              list_name: name,
              year: list.year || null,
              group_id: groupInfo?._id || null,
              group_name: groupInfo?.name || null,
            },
            albums: data,
          });
        } else {
          res.json(data);
        }
      } catch (err) {
        logger.error('Error fetching list:', {
          error: err.message,
          stack: err.stack,
          listName: req.params.name,
          userId: req.user?._id,
        });
        return res.status(500).json({ error: 'Error fetching list' });
      }
    }
  );

  // Reorder list items (lightweight endpoint for drag-and-drop)
  app.post('/api/lists/:name/reorder', ensureAuthAPI, async (req, res) => {
    const { name } = req.params;
    const { order } = req.body;

    if (!order || !Array.isArray(order)) {
      return res.status(400).json({ error: 'Invalid order array' });
    }

    let client;
    try {
      const list = await lists.findOne({ userId: req.user._id, name });
      if (!list) {
        return res.status(404).json({ error: 'List not found' });
      }

      client = await pool.connect();
      try {
        await client.query('BEGIN');

        let effectivePos = 0;
        for (let i = 0; i < order.length; i++) {
          const entry = order[i];
          const now = new Date();

          if (typeof entry === 'string') {
            effectivePos += 1;
            await client.query(
              'UPDATE list_items SET position = $1, updated_at = $2 WHERE list_id = $3 AND album_id = $4',
              [effectivePos, now, list._id, entry]
            );
          } else if (entry && typeof entry === 'object' && entry._id) {
            effectivePos += 1;
            await client.query(
              'UPDATE list_items SET position = $1, updated_at = $2 WHERE _id = $3 AND list_id = $4',
              [effectivePos, now, entry._id, list._id]
            );
          }
        }

        await client.query('COMMIT');

        responseCache.invalidate(
          `GET:/api/lists/${encodeURIComponent(name)}:${req.user._id}`
        );
        responseCache.invalidate(`GET:/api/lists:${req.user._id}`);

        const broadcast = req.app.locals.broadcast;
        if (broadcast) {
          const excludeSocketId = req.headers['x-socket-id'];
          broadcast.listReordered(req.user._id, name, order, {
            excludeSocketId,
          });
        }

        logger.info('List reordered', {
          userId: req.user._id,
          listName: name,
          itemCount: effectivePos,
        });

        res.json({ success: true });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      logger.error('Error reordering list', {
        error: err.message,
        userId: req.user._id,
        listName: name,
      });
      res.status(500).json({ error: 'Error reordering list' });
    }
  });

  // Update single album's comment (lightweight endpoint for inline editing)
  app.patch(
    '/api/lists/:name/items/:identifier/comment',
    ensureAuthAPI,
    async (req, res) => {
      const { name, identifier } = req.params;
      const { comment } = req.body;

      // Validate comment (string or null)
      if (
        comment !== null &&
        comment !== undefined &&
        typeof comment !== 'string'
      ) {
        return res.status(400).json({ error: 'Invalid comment value' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Find list
        const list = await lists.findOne({ userId: req.user._id, name });
        if (!list) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'List not found' });
        }

        // Update list_item by album_id (preferred) or _id (legacy)
        const trimmedComment = comment ? comment.trim() : null;
        let result;

        // Try album_id first (modern albums)
        result = await client.query(
          'UPDATE list_items SET comments = $1, updated_at = $2 WHERE list_id = $3 AND album_id = $4 RETURNING _id',
          [trimmedComment, new Date(), list._id, identifier]
        );

        // Fallback to _id (legacy albums without album_id)
        if (result.rowCount === 0) {
          result = await client.query(
            'UPDATE list_items SET comments = $1, updated_at = $2 WHERE _id = $3 AND list_id = $4 RETURNING _id',
            [trimmedComment, new Date(), identifier, list._id]
          );
        }

        if (result.rowCount === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Album not found in list' });
        }

        await client.query('COMMIT');

        // Invalidate cache
        responseCache.invalidate(
          `GET:/api/lists/${encodeURIComponent(name)}:${req.user._id}`
        );
        responseCache.invalidate(`GET:/api/lists:${req.user._id}`);

        logger.info('Comment updated', {
          userId: req.user._id,
          listName: name,
          identifier,
        });

        res.json({ success: true });
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error('Error updating comment', {
          error: err.message,
          userId: req.user._id,
          listName: name,
        });
        res.status(500).json({ error: 'Error updating comment' });
      } finally {
        client.release();
      }
    }
  );

  // Toggle main list status for a year
  app.post('/api/lists/:name/main', ensureAuthAPI, async (req, res) => {
    const { name } = req.params;
    const { isMain } = req.body;

    // Validate isMain parameter
    if (typeof isMain !== 'boolean') {
      return res.status(400).json({ error: 'isMain must be a boolean' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const listResult = await client.query(
        `SELECT l.id, l.year, l.is_main, g.year as group_year
         FROM lists l
         LEFT JOIN list_groups g ON l.group_id = g.id
         WHERE l.user_id = $1 AND l.name = $2`,
        [req.user._id, name]
      );

      if (listResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'List not found' });
      }

      const list = listResult.rows[0];
      const year = list.year || list.group_year;

      // Handle UNSETTING main status (allow for any list, including orphaned)
      if (isMain === false) {
        await client.query(
          `UPDATE lists SET is_main = FALSE, updated_at = NOW() WHERE id = $1`,
          [list.id]
        );
        await client.query('COMMIT');

        responseCache.invalidate(`GET:/api/lists:${req.user._id}`);

        // Trigger aggregate recompute if list had a year
        if (year) {
          triggerAggregateListRecompute(year);
        }

        logger.info('Main status removed from list', {
          userId: req.user._id,
          listName: name,
          year: year || null,
        });

        return res.json({ success: true, year: year || null });
      }

      // Handle SETTING main status (requires year)
      if (!year) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'List must be assigned to a year to be marked as main',
        });
      }

      // Find previous main list for this year
      const previousMainResult = await client.query(
        `SELECT name FROM lists WHERE user_id = $1 AND year = $2 AND is_main = TRUE`,
        [req.user._id, year]
      );

      // Unset is_main for all other lists in the same year
      await client.query(
        `UPDATE lists SET is_main = FALSE, updated_at = NOW() 
         WHERE user_id = $1 AND year = $2`,
        [req.user._id, year]
      );

      // Set this list as main
      await client.query(
        `UPDATE lists SET is_main = TRUE, updated_at = NOW() 
         WHERE id = $1`,
        [list.id]
      );

      await client.query('COMMIT');

      // Invalidate caches
      responseCache.invalidate(`GET:/api/lists:${req.user._id}`);

      // Trigger aggregate recompute
      triggerAggregateListRecompute(year);

      logger.info('Main status set for list', {
        userId: req.user._id,
        listName: name,
        year,
        previousMainList:
          previousMainResult.rows.length > 0
            ? previousMainResult.rows[0].name
            : null,
      });

      res.json({
        success: true,
        year,
        previousMainList:
          previousMainResult.rows.length > 0
            ? previousMainResult.rows[0].name
            : null,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('Error toggling main list status', {
        error: err.message,
        userId: req.user._id,
        listName: name,
        isMain,
      });
      res.status(500).json({ error: 'Failed to update main list status' });
    } finally {
      client.release();
    }
  });

  // Create or update a list
  app.post('/api/lists/:name', ensureAuthAPI, async (req, res) => {
    const { name } = req.params;
    const { data: rawAlbums, year, groupId: requestGroupId } = req.body;

    if (!rawAlbums || !Array.isArray(rawAlbums)) {
      return res.status(400).json({ error: 'Invalid albums array' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Parse year if provided
      let listYear = null;
      let groupId = null;

      // If groupId is directly provided (for collections), use it
      if (requestGroupId) {
        // Verify the group exists and belongs to this user
        const groupResult = await client.query(
          `SELECT id FROM list_groups WHERE _id = $1 AND user_id = $2`,
          [requestGroupId, req.user._id]
        );
        if (groupResult.rows.length > 0) {
          groupId = groupResult.rows[0].id;
        } else {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Invalid group' });
        }
      } else if (year !== undefined && year !== null) {
        const yearValidation = validateYear(year);
        if (!yearValidation.valid) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: yearValidation.error });
        }
        listYear = yearValidation.value;

        // Find or create year group
        let yearGroupResult = await client.query(
          `SELECT id FROM list_groups WHERE user_id = $1 AND year = $2`,
          [req.user._id, listYear]
        );

        if (yearGroupResult.rows.length === 0) {
          const newGroupId = crypto.randomBytes(12).toString('hex');
          const maxOrder = await client.query(
            `SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM list_groups WHERE user_id = $1`,
            [req.user._id]
          );

          await client.query(
            `INSERT INTO list_groups (_id, user_id, name, year, sort_order, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
            [
              newGroupId,
              req.user._id,
              String(listYear),
              listYear,
              maxOrder.rows[0].next_order,
            ]
          );

          yearGroupResult = await client.query(
            `SELECT id FROM list_groups WHERE _id = $1`,
            [newGroupId]
          );
        }

        groupId = yearGroupResult.rows[0].id;
      }

      // Check if list exists
      let list = await listsAsync.findOne({ userId: req.user._id, name });
      const timestamp = new Date();

      if (!list) {
        // Create new list
        const listId = crypto.randomBytes(12).toString('hex');
        await client.query(
          `INSERT INTO lists (_id, user_id, name, year, group_id, is_main, sort_order, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, FALSE, 0, $6, $7)`,
          [listId, req.user._id, name, listYear, groupId, timestamp, timestamp]
        );
        list = { _id: listId };
      } else {
        // Update existing list
        if (listYear !== null) {
          await client.query(
            `UPDATE lists SET year = $1, group_id = $2, updated_at = $3 WHERE _id = $4`,
            [listYear, groupId, timestamp, list._id]
          );
        }
      }

      // Delete existing items
      await client.query('DELETE FROM list_items WHERE list_id = $1', [
        list._id,
      ]);

      // Insert new items
      for (let i = 0; i < rawAlbums.length; i++) {
        const album = rawAlbums[i];
        const albumId = await upsertAlbumRecord(album, timestamp, client);

        const itemId = crypto.randomBytes(12).toString('hex');
        // Simplified INSERT: only store junction table data + user-specific comments
        // All album metadata comes from canonical albums table
        await client.query(
          `INSERT INTO list_items (
            _id, list_id, album_id, position, comments, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            itemId,
            list._id,
            albumId,
            i + 1,
            album.comments || null,
            timestamp,
            timestamp,
          ]
        );
      }

      await client.query('COMMIT');

      // Invalidate caches - both with and without query params
      responseCache.invalidate(
        `GET:/api/lists/${encodeURIComponent(name)}:${req.user._id}`
      );
      responseCache.invalidate(`GET:/api/lists:${req.user._id}`);
      responseCache.invalidate(`GET:/api/lists?full=true:${req.user._id}`);

      // Trigger aggregate recompute if year is set
      if (listYear) {
        triggerAggregateListRecompute(listYear);
      }

      logger.info('List saved', {
        userId: req.user._id,
        listName: name,
        albumCount: rawAlbums.length,
        year: listYear,
      });

      res.json({ success: true, count: rawAlbums.length });
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('Error saving list:', {
        error: err.message,
        stack: err.stack,
        userId: req.user._id,
        listName: name,
      });
      res.status(500).json({ error: 'Error saving list' });
    } finally {
      client.release();
    }
  });

  // Delete a list
  app.delete('/api/lists/:name', ensureAuthAPI, async (req, res) => {
    const { name } = req.params;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const listResult = await client.query(
        `SELECT id, _id, year, group_id FROM lists WHERE user_id = $1 AND name = $2`,
        [req.user._id, name]
      );

      if (listResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'List not found' });
      }

      const list = listResult.rows[0];

      // Delete list items
      await client.query('DELETE FROM list_items WHERE list_id = $1', [
        list._id,
      ]);

      // Delete list
      await client.query('DELETE FROM lists WHERE id = $1', [list.id]);

      // Check if group is now empty
      if (list.group_id) {
        const groupCount = await client.query(
          `SELECT COUNT(*) as count FROM lists WHERE group_id = $1`,
          [list.group_id]
        );

        if (parseInt(groupCount.rows[0].count, 10) === 0) {
          // Check if it's a year group (auto-delete)
          const groupResult = await client.query(
            `SELECT year FROM list_groups WHERE id = $1`,
            [list.group_id]
          );

          if (
            groupResult.rows.length > 0 &&
            groupResult.rows[0].year !== null
          ) {
            await client.query(`DELETE FROM list_groups WHERE id = $1`, [
              list.group_id,
            ]);
          }
        }
      }

      await client.query('COMMIT');

      // Invalidate caches
      responseCache.invalidate(
        `GET:/api/lists/${encodeURIComponent(name)}:${req.user._id}`
      );
      responseCache.invalidate(`GET:/api/lists:${req.user._id}`);

      // Trigger aggregate recompute
      if (list.year) {
        triggerAggregateListRecompute(list.year);
      }

      logger.info('List deleted', {
        userId: req.user._id,
        listName: name,
      });

      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('Error deleting list', {
        error: err.message,
        userId: req.user._id,
        listName: name,
      });
      res.status(500).json({ error: 'Error deleting list' });
    } finally {
      client.release();
    }
  });
};
