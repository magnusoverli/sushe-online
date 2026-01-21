/**
 * Lists API Routes
 *
 * Handles list management:
 * - Get all lists
 * - Get single list by ID
 * - Create/update/delete lists
 * - Reorder list items
 * - Setup wizard
 * - Bulk operations
 *
 * NOTE: Lists are now identified by ID, not name, to support duplicate names
 * in different categories (groups).
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
    // Note: 'lists' is no longer used - we use findListById() instead
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

  /**
   * Helper to find a list by ID and verify ownership
   * @param {string} listId - The list _id
   * @param {string} userId - The user _id
   * @returns {Object|null} The list or null if not found/unauthorized
   */
  async function findListById(listId, userId) {
    const result = await pool.query(
      `SELECT l.*, g._id as group_external_id, g.name as group_name, g.year as group_year
       FROM lists l
       LEFT JOIN list_groups g ON l.group_id = g.id
       WHERE l._id = $1 AND l.user_id = $2`,
      [listId, userId]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      _id: row._id,
      userId: row.user_id,
      name: row.name,
      year: row.year,
      isMain: row.is_main,
      groupId: row.group_id,
      groupExternalId: row.group_external_id,
      groupName: row.group_name,
      groupYear: row.group_year,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // Get all lists for current user
  app.get(
    '/api/lists',
    ensureAuthAPI,
    cacheConfigs.userSpecific,
    async (req, res) => {
      try {
        const userLists = await listsAsync.find({ userId: req.user._id });
        const { full } = req.query;

        // Changed: Key by _id instead of name
        const listsObj = {};

        if (full === 'true') {
          // FULL MODE: Return all album data (backward compatibility)
          if (typeof listsAsync.findAllUserListsWithItems === 'function') {
            const allRows = await listsAsync.findAllUserListsWithItems(
              req.user._id
            );

            // Group rows by list _id
            const listMap = new Map();
            for (const list of userLists) {
              listMap.set(list._id, { ...list, items: [] });
            }

            for (const row of allRows) {
              // Find the list by name (from the query result)
              const list = userLists.find((l) => l.name === row.list_name);
              if (list && row.position !== null && row.item_id !== null) {
                if (!listMap.has(list._id)) {
                  listMap.set(list._id, { ...list, items: [] });
                }
                listMap.get(list._id).items.push({
                  _id: row.item_id,
                  artist: row.artist || '',
                  album: row.album || '',
                  album_id: row.album_id || '',
                  release_date: row.release_date || '',
                  country: row.country || '',
                  genre_1: row.genre_1 || '',
                  genre_2: row.genre_2 || '',
                  track_pick: row.primary_track || '',
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

            for (const [listId, listData] of listMap) {
              listsObj[listId] = listData.items;
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
                  _id: item._id,
                  artist: item.artist || albumData?.artist,
                  album: item.album || albumData?.album,
                  album_id: item.albumId,
                  release_date: item.releaseDate || albumData?.releaseDate,
                  country: item.country || albumData?.country,
                  genre_1: item.genre1 || albumData?.genre1,
                  genre_2: item.genre2 || albumData?.genre2,
                  track_pick: item.primaryTrack || '',
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
              listsObj[list._id] = mapped;
            }
          }
        } else {
          // METADATA MODE (default): Return only list metadata for fast loading
          // Changed: Key by _id instead of name
          if (typeof listsAsync.findWithCounts === 'function') {
            const listsWithCounts = await listsAsync.findWithCounts({
              userId: req.user._id,
            });
            for (const list of listsWithCounts) {
              listsObj[list._id] = {
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
              listsObj[list._id] = {
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

  // Create a new list
  app.post('/api/lists', ensureAuthAPI, async (req, res) => {
    const { name, groupId: requestGroupId, year, data: rawAlbums } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'List name is required' });
    }

    const trimmedName = name.trim();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Determine the target group
      let listYear = null;
      let groupId = null;

      if (requestGroupId) {
        // Use specified group
        const groupResult = await client.query(
          `SELECT id, year FROM list_groups WHERE _id = $1 AND user_id = $2`,
          [requestGroupId, req.user._id]
        );
        if (groupResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Invalid group' });
        }
        groupId = groupResult.rows[0].id;
        listYear = groupResult.rows[0].year; // Inherit year from group
      } else if (year !== undefined && year !== null) {
        // Create/find year group
        const yearValidation = validateYear(year);
        if (!yearValidation.valid) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: yearValidation.error });
        }
        listYear = yearValidation.value;

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
      } else {
        // Default to Uncategorized group
        let uncatResult = await client.query(
          `SELECT id FROM list_groups WHERE user_id = $1 AND name = 'Uncategorized' AND year IS NULL`,
          [req.user._id]
        );

        if (uncatResult.rows.length === 0) {
          const newGroupId = crypto.randomBytes(12).toString('hex');
          const maxOrder = await client.query(
            `SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM list_groups WHERE user_id = $1`,
            [req.user._id]
          );

          await client.query(
            `INSERT INTO list_groups (_id, user_id, name, year, sort_order, created_at, updated_at)
             VALUES ($1, $2, 'Uncategorized', NULL, $3, NOW(), NOW())`,
            [newGroupId, req.user._id, maxOrder.rows[0].next_order]
          );

          uncatResult = await client.query(
            `SELECT id FROM list_groups WHERE _id = $1`,
            [newGroupId]
          );
        }

        groupId = uncatResult.rows[0].id;
      }

      // Check for duplicate name within the same group
      const duplicateCheck = await client.query(
        `SELECT 1 FROM lists WHERE user_id = $1 AND name = $2 AND group_id = $3`,
        [req.user._id, trimmedName, groupId]
      );

      if (duplicateCheck.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'A list with this name already exists in this category',
        });
      }

      // Create the list
      const listId = crypto.randomBytes(12).toString('hex');
      const timestamp = new Date();

      // Get max sort_order in the group
      const maxListOrder = await client.query(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM lists WHERE group_id = $1`,
        [groupId]
      );

      await client.query(
        `INSERT INTO lists (_id, user_id, name, year, group_id, is_main, sort_order, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, FALSE, $6, $7, $8)`,
        [
          listId,
          req.user._id,
          trimmedName,
          listYear,
          groupId,
          maxListOrder.rows[0].next_order,
          timestamp,
          timestamp,
        ]
      );

      // If albums were provided, add them
      if (rawAlbums && Array.isArray(rawAlbums)) {
        for (let i = 0; i < rawAlbums.length; i++) {
          const album = rawAlbums[i];
          const albumId = await upsertAlbumRecord(album, timestamp, client);

          const itemId = crypto.randomBytes(12).toString('hex');
          await client.query(
            `INSERT INTO list_items (
              _id, list_id, album_id, position, comments, primary_track, secondary_track, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              itemId,
              listId,
              albumId,
              i + 1,
              album.comments || null,
              album.primary_track || null,
              album.secondary_track || null,
              timestamp,
              timestamp,
            ]
          );
        }
      }

      await client.query('COMMIT');

      // Invalidate caches
      responseCache.invalidate(`GET:/api/lists:${req.user._id}`);

      // Trigger aggregate recompute if year is set
      if (listYear) {
        triggerAggregateListRecompute(listYear);
      }

      logger.info('List created', {
        userId: req.user._id,
        listId,
        listName: trimmedName,
        year: listYear,
        albumCount: rawAlbums?.length || 0,
      });

      res.status(201).json({
        success: true,
        _id: listId,
        name: trimmedName,
        year: listYear,
        groupId: requestGroupId || null,
        count: rawAlbums?.length || 0,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('Error creating list', {
        error: err.message,
        stack: err.stack,
        userId: req.user._id,
        listName: name,
      });
      res.status(500).json({ error: 'Error creating list' });
    } finally {
      client.release();
    }
  });

  // Get a single list by ID
  app.get(
    '/api/lists/:id',
    ensureAuthAPI,
    cacheConfigs.userSpecific,
    async (req, res) => {
      try {
        const { id } = req.params;
        const isExport = req.query.export === 'true';

        logger.debug('Fetching list by ID', {
          listId: id,
          userId: req.user._id,
          isExport,
        });

        const list = await findListById(id, req.user._id);

        if (!list) {
          logger.warn('List not found', { listId: id, userId: req.user._id });
          return res.status(404).json({ error: 'List not found' });
        }

        logger.debug('List found', { listId: list._id, name: list.name });

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
          track_pick: item.primaryTrack || '',
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
          res.json({
            _metadata: {
              list_id: list._id,
              list_name: list.name,
              year: list.year || null,
              group_id: list.groupExternalId || null,
              group_name: list.groupName || null,
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
          listId: req.params.id,
          userId: req.user?._id,
        });
        return res.status(500).json({ error: 'Error fetching list' });
      }
    }
  );

  // Update list metadata (rename, change year, move to group)
  app.patch('/api/lists/:id', ensureAuthAPI, async (req, res) => {
    const { id } = req.params;
    const { name: newName, year, groupId: newGroupId } = req.body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Find the list
      const listResult = await client.query(
        `SELECT l.id, l._id, l.name, l.year, l.group_id, g.year as group_year
         FROM lists l
         LEFT JOIN list_groups g ON l.group_id = g.id
         WHERE l._id = $1 AND l.user_id = $2`,
        [id, req.user._id]
      );

      if (listResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'List not found' });
      }

      const list = listResult.rows[0];
      const updates = [];
      const values = [];
      let paramIndex = 1;

      let targetGroupId = list.group_id;
      let targetYear = list.year;

      // Handle group change
      if (newGroupId !== undefined) {
        if (newGroupId === null) {
          // Cannot remove group - all lists must have a group now
          await client.query('ROLLBACK');
          return res
            .status(400)
            .json({ error: 'Lists must belong to a category' });
        }

        const groupResult = await client.query(
          `SELECT id, year FROM list_groups WHERE _id = $1 AND user_id = $2`,
          [newGroupId, req.user._id]
        );

        if (groupResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Invalid group' });
        }

        targetGroupId = groupResult.rows[0].id;
        targetYear = groupResult.rows[0].year;

        updates.push(`group_id = $${paramIndex++}`);
        values.push(targetGroupId);

        updates.push(`year = $${paramIndex++}`);
        values.push(targetYear);
      } else if (year !== undefined) {
        // Handle year change without group change
        const yearValidation = validateYear(year);
        if (year !== null && !yearValidation.valid) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: yearValidation.error });
        }
        targetYear = year === null ? null : yearValidation.value;

        updates.push(`year = $${paramIndex++}`);
        values.push(targetYear);
      }

      // Handle name change
      if (newName !== undefined) {
        if (typeof newName !== 'string' || newName.trim().length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'List name cannot be empty' });
        }

        const trimmedName = newName.trim();

        // Check for duplicate name within the same group
        if (trimmedName !== list.name) {
          const duplicateCheck = await client.query(
            `SELECT 1 FROM lists WHERE user_id = $1 AND name = $2 AND group_id = $3 AND _id != $4`,
            [req.user._id, trimmedName, targetGroupId, id]
          );

          if (duplicateCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
              error: 'A list with this name already exists in this category',
            });
          }
        }

        updates.push(`name = $${paramIndex++}`);
        values.push(trimmedName);
      }

      if (updates.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'No updates provided' });
      }

      updates.push(`updated_at = $${paramIndex++}`);
      values.push(new Date());

      values.push(list.id);

      await client.query(
        `UPDATE lists SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
        values
      );

      await client.query('COMMIT');

      // Invalidate caches
      responseCache.invalidate(`GET:/api/lists/${id}:${req.user._id}`);
      responseCache.invalidate(`GET:/api/lists:${req.user._id}`);

      // Trigger aggregate recompute for affected years
      if (list.year !== null) triggerAggregateListRecompute(list.year);
      if (targetYear !== null && targetYear !== list.year) {
        triggerAggregateListRecompute(targetYear);
      }

      // Broadcast rename event if name changed
      const broadcast = req.app.locals.broadcast;
      if (broadcast && newName && newName.trim() !== list.name) {
        broadcast.listRenamed(req.user._id, list.name, newName.trim());
      }

      logger.info('List updated', {
        userId: req.user._id,
        listId: id,
        oldName: list.name,
        newName: newName?.trim() || list.name,
        oldYear: list.year,
        newYear: targetYear,
      });

      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('Error updating list', {
        error: err.message,
        userId: req.user._id,
        listId: id,
      });
      res.status(500).json({ error: 'Error updating list' });
    } finally {
      client.release();
    }
  });

  // Update list items (full replacement)
  app.put('/api/lists/:id', ensureAuthAPI, async (req, res) => {
    const { id } = req.params;
    const { data: rawAlbums } = req.body;

    if (!rawAlbums || !Array.isArray(rawAlbums)) {
      return res.status(400).json({ error: 'Invalid albums array' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const list = await findListById(id, req.user._id);
      if (!list) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'List not found' });
      }

      const timestamp = new Date();

      // Delete existing items
      await client.query('DELETE FROM list_items WHERE list_id = $1', [
        list._id,
      ]);

      // Insert new items
      for (let i = 0; i < rawAlbums.length; i++) {
        const album = rawAlbums[i];
        const albumId = await upsertAlbumRecord(album, timestamp, client);

        const itemId = crypto.randomBytes(12).toString('hex');
        await client.query(
          `INSERT INTO list_items (
            _id, list_id, album_id, position, comments, primary_track, secondary_track, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            itemId,
            list._id,
            albumId,
            i + 1,
            album.comments || null,
            album.primary_track || null,
            album.secondary_track || null,
            timestamp,
            timestamp,
          ]
        );
      }

      // Update list timestamp
      await client.query('UPDATE lists SET updated_at = $1 WHERE _id = $2', [
        timestamp,
        list._id,
      ]);

      await client.query('COMMIT');

      // Invalidate caches
      responseCache.invalidate(`GET:/api/lists/${id}:${req.user._id}`);
      responseCache.invalidate(`GET:/api/lists:${req.user._id}`);
      responseCache.invalidate(`GET:/api/lists?full=true:${req.user._id}`);

      // Trigger aggregate recompute if year is set
      if (list.year) {
        triggerAggregateListRecompute(list.year);
      }

      logger.info('List items replaced', {
        userId: req.user._id,
        listId: id,
        listName: list.name,
        albumCount: rawAlbums.length,
      });

      res.json({ success: true, count: rawAlbums.length });
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('Error updating list items', {
        error: err.message,
        stack: err.stack,
        userId: req.user._id,
        listId: id,
      });
      res.status(500).json({ error: 'Error updating list' });
    } finally {
      client.release();
    }
  });

  // Reorder list items (lightweight endpoint for drag-and-drop)
  app.post('/api/lists/:id/reorder', ensureAuthAPI, async (req, res) => {
    const { id } = req.params;
    const { order } = req.body;

    if (!order || !Array.isArray(order)) {
      return res.status(400).json({ error: 'Invalid order array' });
    }

    let client;
    try {
      const list = await findListById(id, req.user._id);
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

        responseCache.invalidate(`GET:/api/lists/${id}:${req.user._id}`);
        responseCache.invalidate(`GET:/api/lists:${req.user._id}`);

        const broadcast = req.app.locals.broadcast;
        if (broadcast) {
          const excludeSocketId = req.headers['x-socket-id'];
          broadcast.listReordered(req.user._id, list._id, order, {
            excludeSocketId,
          });
        }

        logger.info('List reordered', {
          userId: req.user._id,
          listId: id,
          listName: list.name,
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
        listId: id,
      });
      res.status(500).json({ error: 'Error reordering list' });
    }
  });

  // Update single album's comment (lightweight endpoint for inline editing)
  app.patch(
    '/api/lists/:id/items/:identifier/comment',
    ensureAuthAPI,
    async (req, res) => {
      const { id, identifier } = req.params;
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

        const list = await findListById(id, req.user._id);
        if (!list) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'List not found' });
        }

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

        responseCache.invalidate(`GET:/api/lists/${id}:${req.user._id}`);
        responseCache.invalidate(`GET:/api/lists:${req.user._id}`);

        logger.info('Comment updated', {
          userId: req.user._id,
          listId: id,
          identifier,
        });

        res.json({ success: true });
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error('Error updating comment', {
          error: err.message,
          userId: req.user._id,
          listId: id,
        });
        res.status(500).json({ error: 'Error updating comment' });
      } finally {
        client.release();
      }
    }
  );

  // Incremental list update (add/remove/update items without full rebuild)
  app.patch('/api/lists/:id/items', ensureAuthAPI, async (req, res) => {
    const { id } = req.params;
    const { added, removed, updated } = req.body;

    if (!added && !removed && !updated) {
      return res.status(400).json({ error: 'No changes specified' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const list = await findListById(id, req.user._id);
      if (!list) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'List not found' });
      }

      const timestamp = new Date();
      let changeCount = 0;

      // Process removals first (by album_id)
      if (removed && Array.isArray(removed)) {
        for (const albumId of removed) {
          if (!albumId) continue;
          const result = await client.query(
            'DELETE FROM list_items WHERE list_id = $1 AND album_id = $2',
            [list._id, albumId]
          );
          changeCount += result.rowCount;
        }
      }

      // Process additions (with position)
      if (added && Array.isArray(added)) {
        for (const item of added) {
          if (!item) continue;

          const albumId = await upsertAlbumRecord(item, timestamp, client);

          const existing = await client.query(
            'SELECT _id FROM list_items WHERE list_id = $1 AND album_id = $2',
            [list._id, albumId]
          );

          if (existing.rows.length === 0) {
            const itemId = crypto.randomBytes(12).toString('hex');
            await client.query(
              `INSERT INTO list_items (
                _id, list_id, album_id, position, comments, primary_track, secondary_track, created_at, updated_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [
                itemId,
                list._id,
                albumId,
                item.position || 0,
                item.comments || null,
                item.primary_track || null,
                item.secondary_track || null,
                timestamp,
                timestamp,
              ]
            );
            changeCount++;
          }
        }
      }

      // Process position updates (for reordering existing items)
      if (updated && Array.isArray(updated)) {
        for (const item of updated) {
          if (!item || !item.album_id) continue;

          const result = await client.query(
            'UPDATE list_items SET position = $1, updated_at = $2 WHERE list_id = $3 AND album_id = $4',
            [item.position, timestamp, list._id, item.album_id]
          );
          changeCount += result.rowCount;
        }
      }

      // Update list timestamp
      await client.query('UPDATE lists SET updated_at = $1 WHERE _id = $2', [
        timestamp,
        list._id,
      ]);

      await client.query('COMMIT');

      responseCache.invalidate(`GET:/api/lists/${id}:${req.user._id}`);
      responseCache.invalidate(`GET:/api/lists:${req.user._id}`);
      responseCache.invalidate(`GET:/api/lists?full=true:${req.user._id}`);

      const broadcast = req.app.locals.broadcast;
      if (broadcast) {
        const excludeSocketId = req.headers['x-socket-id'];
        broadcast.listUpdated(req.user._id, list._id, { excludeSocketId });
      }

      if (list.year) {
        triggerAggregateListRecompute(list.year);
      }

      logger.info('List incrementally updated', {
        userId: req.user._id,
        listId: id,
        listName: list.name,
        added: added?.length || 0,
        removed: removed?.length || 0,
        updated: updated?.length || 0,
        totalChanges: changeCount,
      });

      res.json({ success: true, changes: changeCount });
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('Error incrementally updating list', {
        error: err.message,
        stack: err.stack,
        userId: req.user._id,
        listId: id,
      });
      res.status(500).json({ error: 'Error updating list' });
    } finally {
      client.release();
    }
  });

  // Toggle main list status for a year
  app.post('/api/lists/:id/main', ensureAuthAPI, async (req, res) => {
    const { id } = req.params;
    const { isMain } = req.body;

    if (typeof isMain !== 'boolean') {
      return res.status(400).json({ error: 'isMain must be a boolean' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const listResult = await client.query(
        `SELECT l.id, l._id, l.name, l.year, l.is_main, g.year as group_year
         FROM lists l
         LEFT JOIN list_groups g ON l.group_id = g.id
         WHERE l._id = $1 AND l.user_id = $2`,
        [id, req.user._id]
      );

      if (listResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'List not found' });
      }

      const list = listResult.rows[0];
      const year = list.year || list.group_year;

      if (isMain === false) {
        await client.query(
          `UPDATE lists SET is_main = FALSE, updated_at = NOW() WHERE id = $1`,
          [list.id]
        );
        await client.query('COMMIT');

        responseCache.invalidate(`GET:/api/lists:${req.user._id}`);

        if (year) {
          triggerAggregateListRecompute(year);
        }

        logger.info('Main status removed from list', {
          userId: req.user._id,
          listId: id,
          listName: list.name,
          year: year || null,
        });

        return res.json({ success: true, year: year || null });
      }

      if (!year) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'List must be assigned to a year to be marked as main',
        });
      }

      // Find all OTHER lists that share the same year and are currently main
      // Excludes the current list being set as main
      // This includes:
      // 1. Lists with year = $year directly
      // 2. Lists in a group where group.year = $year
      const previousMainResult = await client.query(
        `SELECT l._id, l.name FROM lists l
         LEFT JOIN list_groups g ON l.group_id = g.id
         WHERE l.user_id = $1 
           AND (l.year = $2 OR g.year = $2)
           AND l.is_main = TRUE
           AND l._id != $3`,
        [req.user._id, year, id]
      );

      // Clear main status for all lists in the same year (direct or via group)
      await client.query(
        `UPDATE lists SET is_main = FALSE, updated_at = NOW() 
         WHERE user_id = $1 
           AND id IN (
             SELECT l.id FROM lists l
             LEFT JOIN list_groups g ON l.group_id = g.id
             WHERE l.user_id = $1 AND (l.year = $2 OR g.year = $2)
           )`,
        [req.user._id, year]
      );

      await client.query(
        `UPDATE lists SET is_main = TRUE, updated_at = NOW() 
         WHERE id = $1`,
        [list.id]
      );

      await client.query('COMMIT');

      responseCache.invalidate(`GET:/api/lists:${req.user._id}`);
      triggerAggregateListRecompute(year);

      logger.info('Main status set for list', {
        userId: req.user._id,
        listId: id,
        listName: list.name,
        year,
        previousMainList:
          previousMainResult.rows.length > 0
            ? previousMainResult.rows[0].name
            : null,
      });

      res.json({
        success: true,
        year,
        previousMainListId:
          previousMainResult.rows.length > 0
            ? previousMainResult.rows[0]._id
            : null,
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
        listId: id,
        isMain,
      });
      res.status(500).json({ error: 'Failed to update main list status' });
    } finally {
      client.release();
    }
  });

  // Delete a list
  app.delete('/api/lists/:id', ensureAuthAPI, async (req, res) => {
    const { id } = req.params;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const listResult = await client.query(
        `SELECT id, _id, name, year, group_id FROM lists WHERE _id = $1 AND user_id = $2`,
        [id, req.user._id]
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

      responseCache.invalidate(`GET:/api/lists/${id}:${req.user._id}`);
      responseCache.invalidate(`GET:/api/lists:${req.user._id}`);

      if (list.year) {
        triggerAggregateListRecompute(list.year);
      }

      logger.info('List deleted', {
        userId: req.user._id,
        listId: id,
        listName: list.name,
      });

      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('Error deleting list', {
        error: err.message,
        userId: req.user._id,
        listId: id,
      });
      res.status(500).json({ error: 'Error deleting list' });
    } finally {
      client.release();
    }
  });
};
