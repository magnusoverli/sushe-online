module.exports = (app, deps) => {
  const logger = require('../utils/logger');
  const { recordAuthAttempt } = require('../utils/metrics');
  const {
    loginRateLimit,
    registerRateLimit,
    sensitiveSettingsRateLimit,
  } = require('../middleware/rate-limit');
  const {
    htmlTemplate,
    registerTemplate,
    loginTemplate,

    spotifyTemplate,
    settingsTemplate,
    isTokenUsable,
    csrfProtection,
    ensureAuth,
    ensureAuthAPI,
    rateLimitAdminRequest,
    users,
    usersAsync,
    listsAsync,
    listItemsAsync,
    bcrypt,
    isValidEmail,
    isValidUsername,
    isValidPassword,

    sanitizeUser,
    adminCodeAttempts,
    adminCode,
    adminCodeExpiry,
    generateAdminCode,
    pool,
    passport,
  } = deps;

  // ============ ROUTES ============

  // Registration routes
  app.get('/register', csrfProtection, (req, res) => {
    res.send(
      htmlTemplate(
        registerTemplate(req, res.locals.flash),
        'Join the KVLT - Black Metal Auth'
      )
    );
  });

  app.post('/register', registerRateLimit, csrfProtection, async (req, res) => {
    try {
      const { email, username, password, confirmPassword } = req.body;

      // Validate all fields are present
      if (!email || !username || !password || !confirmPassword) {
        req.flash('error', 'All fields are required');
        return res.redirect('/register');
      }

      // Check passwords match
      if (password !== confirmPassword) {
        req.flash('error', 'Passwords do not match');
        return res.redirect('/register');
      }

      // Validate email format
      if (!isValidEmail(email)) {
        req.flash('error', 'Please enter a valid email address');
        return res.redirect('/register');
      }

      // Validate username format/length
      if (!isValidUsername(username)) {
        req.flash(
          'error',
          'Username can only contain letters, numbers, and underscores and must be 3-30 characters'
        );
        return res.redirect('/register');
      }

      // Validate password length
      if (!isValidPassword(password)) {
        req.flash('error', 'Password must be at least 8 characters');
        return res.redirect('/register');
      }

      // Check if email already exists
      try {
        const existingEmailUser = await usersAsync.findOne({ email });
        if (existingEmailUser) {
          req.flash('error', 'Email already registered');
          return res.redirect('/register');
        }

        // Check if username already exists
        const existingUsernameUser = await usersAsync.findOne({ username });

        if (existingUsernameUser) {
          req.flash('error', 'Username already taken');
          return res.redirect('/register');
        }

        // Hash password and create user
        const hash = await bcrypt.hash(password, 12);
        if (!hash) {
          req.flash('error', 'Registration error. Please try again.');
          return res.redirect('/register');
        }

        // Insert new user with pending approval status
        const newUser = await usersAsync.insert({
          email,
          username,
          hash,
          spotifyAuth: null,
          tidalAuth: null,
          tidalCountry: null,
          accentColor: '#dc2626',
          timeFormat: '24h',
          dateFormat: 'MM/DD/YYYY',
          approvalStatus: 'pending',
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        logger.info('New user registered (pending approval)', {
          email,
          username,
        });

        // Create admin event for approval with Telegram notification
        try {
          const adminEventService = app.locals.adminEventService;
          if (adminEventService) {
            await adminEventService.createEvent({
              type: 'account_approval',
              title: 'New User Registration',
              description: `User "${username}" (${email}) has registered and needs approval.`,
              data: {
                userId: newUser._id,
                username,
                email,
              },
              priority: 'normal',
              actions: [
                { id: 'approve', label: '✅ Approve' },
                { id: 'reject', label: '❌ Reject' },
              ],
            });
            logger.info('Admin event created for registration approval', {
              username,
            });
          } else {
            logger.warn(
              'Admin event service not available, skipping approval event'
            );
          }
        } catch (eventError) {
          // Don't fail registration if event creation fails
          logger.error('Failed to create admin event for registration', {
            error: eventError.message,
          });
        }

        recordAuthAttempt('register', 'success');
        req.flash(
          'success',
          'Registration successful! Your account is pending admin approval.'
        );
        res.redirect('/login');
      } catch (err) {
        logger.error('Database error during registration', {
          error: err.message,
        });
        recordAuthAttempt('register', 'failure');
        req.flash('error', 'Registration error. Please try again.');
        return res.redirect('/register');
      }
    } catch (error) {
      logger.error('Registration error', { error: error.message });
      recordAuthAttempt('register', 'failure');
      req.flash('error', 'Registration error. Please try again.');
      res.redirect('/register');
    }
  });

  app.post('/api/user/last-list', ensureAuthAPI, (req, res) => {
    const { listName } = req.body;

    users.update(
      { _id: req.user._id },
      { $set: { lastSelectedList: listName, updatedAt: new Date() } },
      {},
      (err) => {
        if (err) {
          logger.error('Error updating last selected list', {
            error: err.message,
            userId: req.user._id,
          });
          return res
            .status(500)
            .json({ error: 'Error updating last selected list' });
        }

        // Update the session user object
        req.user.lastSelectedList = listName;
        req.session.save();

        res.json({ success: true });
      }
    );
  });

  // Login routes
  app.get('/login', csrfProtection, (req, res) => {
    // Redirect if already authenticated
    if (req.isAuthenticated()) {
      return res.redirect('/');
    }

    // Debug CSRF token generation
    logger.debug('Login GET - CSRF token generation', {
      hasSession: !!req.session,
      hasSecret: !!req.session?.csrfSecret,
      sessionId: req.sessionID,
      userAgent: req.get('User-Agent'),
    });

    res.send(
      htmlTemplate(loginTemplate(req, res.locals.flash), 'SuShe Online')
    );
  });

  app.post('/login', loginRateLimit, csrfProtection, async (req, res, next) => {
    logger.debug('Login POST request received', {
      email: req.body.email,
      hasSession: !!req.session,
      hasSecret: !!req.session?.csrfSecret,
      sessionId: req.sessionID,
      csrfToken: req.body._csrf?.substring(0, 8) + '...',
      userAgent: req.get('User-Agent'),
    });

    try {
      const { user, info } = await new Promise((resolve, reject) => {
        passport.authenticate('local', (err, user, info) => {
          if (err) return reject(err);
          resolve({ user, info });
        })(req, res, next);
      });

      if (!user) {
        logger.warn('Authentication failed', {
          reason: info?.message,
          email: req.body.email,
          requestId: req.id,
        });
        recordAuthAttempt('login', 'failure');
        req.flash('error', info.message || 'Invalid credentials');

        // Force session save before redirect to ensure flash messages persist
        await new Promise((resolve) => {
          req.session.save((err) => {
            if (err) {
              logger.error('Session save error', {
                error: err.message,
                requestId: req.id,
              });
            }
            resolve();
          });
        });

        return res.redirect('/login');
      }

      await new Promise((resolve, reject) => {
        req.logIn(user, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });

      logger.info('User logged in successfully', { email: user.email });
      recordAuthAttempt('login', 'success');

      // "Remember me" support:
      // The login form sends `remember=on` (checkbox). If set, extend the session cookie.
      // Otherwise keep the default shorter session lifetime.
      // Note: express-session persists cookie options into the session store on save.
      const remember =
        req.body.remember === 'on' ||
        req.body.remember === 'true' ||
        req.body.remember === true;
      const oneDayMs = 1000 * 60 * 60 * 24;
      const rememberMs = 30 * oneDayMs;
      req.session.cookie.maxAge = remember ? rememberMs : oneDayMs;

      // Record last activity (always update on login)
      const timestamp = new Date();
      req.user.lastActivity = timestamp;
      // Set debounce timestamp so subsequent requests don't immediately re-update
      req.session.lastActivityUpdatedAt = Date.now();
      await usersAsync.update(
        { _id: req.user._id },
        { $set: { lastActivity: timestamp } }
      );

      // Force session save and handle errors
      await new Promise((resolve) => {
        req.session.save((err) => {
          if (err) {
            logger.error('Session save error', { error: err.message });
            // Continue anyway - session might still work
          }
          resolve();
        });
      });

      // Check if this login was for extension authorization
      if (req.session.extensionAuth) {
        delete req.session.extensionAuth;
        return res.redirect('/extension/auth');
      }

      return res.redirect('/');
    } catch (err) {
      logger.error('Authentication error', { error: err.message });
      req.flash('error', 'An error occurred during login');
      return res.redirect('/login');
    }
  });

  // Logout
  app.get('/logout', (req, res) => {
    recordAuthAttempt('logout', 'success');
    req.logout(() => res.redirect('/login'));
  });

  // Home (protected) - Spotify-like interface
  app.get('/', ensureAuth, csrfProtection, (req, res) => {
    res.send(spotifyTemplate(sanitizeUser(req.user), req.csrfToken()));
  });

  // Unified Settings Page
  app.get('/settings', ensureAuth, csrfProtection, async (req, res) => {
    // Prevent browser caching so OAuth redirects show fresh state
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    try {
      // For Spotify, use isTokenUsable since we can auto-refresh expired tokens
      const spotifyValid = isTokenUsable(req.user.spotifyAuth);
      // For Tidal, use isTokenUsable since we can now auto-refresh expired tokens
      const tidalValid = isTokenUsable(req.user.tidalAuth);
      // For Last.fm, sessions never expire, just check if connected
      const {
        isSessionValid: isLastfmSessionValid,
      } = require('../utils/lastfm-auth');
      const lastfmValid = isLastfmSessionValid(req.user.lastfmAuth);

      const sanitized = sanitizeUser(req.user);
      // Get user's personal stats
      const userLists = await listsAsync.find({ userId: req.user._id });
      let albumCount = 0;
      for (const l of userLists) {
        albumCount += await listItemsAsync.count({ listId: l._id });
      }
      const userStats = {
        listCount: userLists.length,
        totalAlbums: albumCount,
      };

      // Get user's music preferences
      let musicPreferences = null;
      try {
        const { createUserPreferences } = require('../utils/user-preferences');
        const userPrefs = createUserPreferences({ pool, logger });
        const prefs = await userPrefs.getPreferences(req.user._id);
        if (prefs) {
          musicPreferences = {
            // Consolidated affinity scores (from all sources)
            topGenres: prefs.genre_affinity || [],
            topArtists: prefs.artist_affinity || [],
            topCountries: prefs.country_affinity || prefs.top_countries || [],
            totalAlbums: prefs.total_albums || 0,
            // Source-specific data for detailed view
            spotify: {
              topArtists: prefs.spotify_top_artists || {},
              topTracks: prefs.spotify_top_tracks || {},
              syncedAt: prefs.spotify_synced_at,
            },
            lastfm: {
              topArtists: prefs.lastfm_top_artists || {},
              topAlbums: prefs.lastfm_top_albums || {},
              totalScrobbles: prefs.lastfm_total_scrobbles || 0,
              syncedAt: prefs.lastfm_synced_at,
            },
            updatedAt: prefs.updated_at,
          };
        }
      } catch (prefsError) {
        logger.error('Error fetching music preferences', {
          error: prefsError.message,
          userId: req.user._id,
        });
        // Continue without preferences - not critical
      }

      // If admin, get admin data
      let adminData = null;
      let stats = null;

      if (req.user.role === 'admin') {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const twoWeeksAgo = new Date();
        twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

        // OPTIMIZATION: Parallel fetch of all independent data
        // Reduces N+1 queries to 4 parallel queries using aggregates
        const [allUsers, allLists, userListCountsResult, adminStatsResult] =
          await Promise.all([
            usersAsync.find({}),
            listsAsync.find({}),
            // Single query for user list counts (replaces N async count calls)
            pool.query(
              'SELECT user_id, COUNT(*) as list_count FROM lists GROUP BY user_id'
            ),
            // OPTIMIZATION: Single aggregate query for album/genre stats
            // Replaces N+1 loop through all lists
            pool.query(
              `
            WITH album_genres AS (
              SELECT DISTINCT li.album_id, li.genre_1, li.genre_2 
              FROM list_items li
            ),
            unique_albums AS (
              SELECT COUNT(DISTINCT album_id) as total 
              FROM album_genres 
              WHERE album_id IS NOT NULL AND album_id != ''
            ),
            genre_counts AS (
              SELECT genre, SUM(cnt)::int as count FROM (
                SELECT genre_1 as genre, COUNT(*) as cnt FROM album_genres 
                WHERE genre_1 IS NOT NULL AND genre_1 NOT IN ('', 'Genre 1') 
                GROUP BY genre_1
                UNION ALL
                SELECT genre_2 as genre, COUNT(*) as cnt FROM album_genres 
                WHERE genre_2 IS NOT NULL AND genre_2 NOT IN ('', 'Genre 2', '-') 
                GROUP BY genre_2
              ) g GROUP BY genre ORDER BY count DESC LIMIT 5
            ),
            active_users AS (
              SELECT COUNT(DISTINCT user_id) as count FROM lists WHERE updated_at >= $1
            )
            SELECT 
              (SELECT total FROM unique_albums) as total_albums,
              (SELECT count FROM active_users) as active_users,
              COALESCE((SELECT json_agg(json_build_object('name', genre, 'count', count)) FROM genre_counts), '[]'::json) as top_genres
          `,
              [sevenDaysAgo]
            ),
          ]);

        // Build Map for O(1) list count lookup
        const listCountMap = new Map(
          userListCountsResult.rows.map((r) => [
            r.user_id,
            parseInt(r.list_count, 10),
          ])
        );

        const usersWithCounts = allUsers.map((user) => ({
          ...user,
          listCount: listCountMap.get(user._id) || 0,
        }));

        // Extract stats from aggregate query
        const aggregateStats = adminStatsResult.rows[0] || {};
        const totalAlbums = parseInt(aggregateStats.total_albums, 10) || 0;
        const activeUsers = parseInt(aggregateStats.active_users, 10) || 0;
        const topGenres = aggregateStats.top_genres || [];

        // Calculate user growth
        const usersThisWeek = allUsers.filter(
          (u) => new Date(u.createdAt) >= sevenDaysAgo
        ).length;
        const usersLastWeek = allUsers.filter((u) => {
          const createdAt = new Date(u.createdAt);
          return createdAt >= twoWeeksAgo && createdAt < sevenDaysAgo;
        }).length;

        const userGrowth =
          usersLastWeek > 0
            ? Math.round(
                ((usersThisWeek - usersLastWeek) / usersLastWeek) * 100
              )
            : usersThisWeek > 0
              ? 100
              : 0;

        // Get top users by list count
        const topUsers = usersWithCounts
          .filter((u) => u.listCount > 0)
          .sort((a, b) => b.listCount - a.listCount)
          .slice(0, 5);

        // Calculate database size
        let dbSize = 'N/A';
        try {
          const { rows } = await pool.query(
            'SELECT pg_size_pretty(pg_database_size(current_database())) AS size'
          );
          dbSize = rows[0].size;
        } catch (e) {
          logger.error('Error calculating DB size', { error: e.message });
        }

        // Count active sessions from PostgreSQL
        let activeSessions = 0;
        try {
          const { rows } = await pool.query(
            'SELECT COUNT(*) AS count FROM session WHERE expire > NOW()'
          );
          activeSessions = parseInt(rows[0].count, 10);
        } catch (e) {
          logger.error('Error counting sessions', { error: e.message });
        }

        stats = {
          totalUsers: allUsers.length,
          totalLists: allLists.length,
          totalAlbums,
          adminUsers: allUsers.filter((u) => u.role === 'admin').length,
          activeUsers,
          userGrowth,
          dbSize,
          activeSessions,
          topGenres,
          topUsers,
        };

        // Generate real recent activity based on actual data
        const recentActivity = [];

        // Find recent user registrations
        const recentUsers = allUsers
          .filter((u) => u.createdAt)
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .slice(0, 2);

        recentUsers.forEach((user) => {
          const timeAgo = getTimeAgo(new Date(user.createdAt));
          recentActivity.push({
            icon: 'fa-user-plus',
            color: 'green',
            message: `New user: ${user.username}`,
            time: timeAgo,
          });
        });

        // Find recent list creations
        const recentLists = allLists
          .filter((l) => l.createdAt)
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .slice(0, 2);

        recentLists.forEach((list) => {
          const timeAgo = getTimeAgo(new Date(list.createdAt));
          recentActivity.push({
            icon: 'fa-list',
            color: 'blue',
            message: `New list: ${list.name}`,
            time: timeAgo,
          });
        });

        // Find recent admin grants
        const recentAdmins = allUsers
          .filter((u) => u.role === 'admin' && u.adminGrantedAt)
          .sort(
            (a, b) => new Date(b.adminGrantedAt) - new Date(a.adminGrantedAt)
          )
          .slice(0, 1);

        recentAdmins.forEach((admin) => {
          const timeAgo = getTimeAgo(new Date(admin.adminGrantedAt));
          recentActivity.push({
            icon: 'fa-user-shield',
            color: 'yellow',
            message: `Admin granted: ${admin.username}`,
            time: timeAgo,
          });
        });

        // Sort by time and take the most recent 4
        recentActivity.sort((a, b) => {
          // This is a simplified sort - in production you'd want to store actual timestamps
          const timeValues = {
            'just now': 0,
            'minutes ago': 1,
            hour: 2,
            'hours ago': 3,
            day: 4,
            'days ago': 5,
          };
          const aValue =
            Object.keys(timeValues).find((key) => a.time.includes(key)) || 6;
          const bValue =
            Object.keys(timeValues).find((key) => b.time.includes(key)) || 6;
          return timeValues[aValue] - timeValues[bValue];
        });

        // Ensure we have at least 4 items (pad with defaults if needed)
        while (recentActivity.length < 4) {
          recentActivity.push({
            icon: 'fa-clock',
            color: 'gray',
            message: 'No recent activity',
            time: '-',
          });
        }

        adminData = {
          users: usersWithCounts,
          stats,
          recentActivity: recentActivity.slice(0, 4),
        };
      }

      res.send(
        settingsTemplate(req, {
          user: sanitized,
          userStats,
          stats,
          adminData,
          flash: res.locals.flash,
          spotifyValid,
          tidalValid,
          lastfmValid,
          lastfmUsername: req.user.lastfmUsername || null,
          musicPreferences,
        })
      );
    } catch (error) {
      logger.error('Settings page error', {
        error: error.message,
        userId: req.user._id,
      });
      req.flash('error', 'Error loading settings');
      res.redirect('/');
    }
  });

  // Update accent color endpoint
  app.post('/settings/update-accent-color', ensureAuth, async (req, res) => {
    try {
      const { accentColor } = req.body;

      // Validate hex color format
      const hexColorRegex = /^#[0-9A-F]{6}$/i;
      if (!hexColorRegex.test(accentColor)) {
        return res.status(400).json({
          error: 'Invalid color format. Please use hex format (#RRGGBB)',
        });
      }

      // Update user's accent color
      users.update(
        { _id: req.user._id },
        { $set: { accentColor, updatedAt: new Date() } },
        {},
        (err) => {
          if (err) {
            logger.error('Error updating accent color', {
              error: err.message,
              userId: req.user._id,
            });
            return res
              .status(500)
              .json({ error: 'Error updating theme color' });
          }

          // Update session
          req.user.accentColor = accentColor;
          req.session.save((err) => {
            if (err) logger.error('Session save error', { error: err.message });
            res.json({ success: true });
          });

          logger.info(
            `User ${req.user.email} updated accent color to ${accentColor}`
          );
        }
      );
    } catch (error) {
      logger.error('Update accent color error', {
        error: error.message,
        userId: req.user._id,
      });
      res.status(500).json({ error: 'Error updating theme color' });
    }
  });

  // Update time format endpoint
  app.post('/settings/update-time-format', ensureAuth, async (req, res) => {
    try {
      const { timeFormat } = req.body;
      if (!['12h', '24h'].includes(timeFormat)) {
        return res.status(400).json({ error: 'Invalid time format' });
      }

      users.update(
        { _id: req.user._id },
        { $set: { timeFormat, updatedAt: new Date() } },
        {},
        (err) => {
          if (err) {
            logger.error('Error updating time format', {
              error: err.message,
              userId: req.user._id,
            });
            return res
              .status(500)
              .json({ error: 'Error updating time format' });
          }

          req.user.timeFormat = timeFormat;
          req.session.save((err) => {
            if (err) logger.error('Session save error', { error: err.message });
            res.json({ success: true });
          });

          logger.info(
            `User ${req.user.email} updated time format to ${timeFormat}`
          );
        }
      );
    } catch (error) {
      logger.error('Update time format error', {
        error: error.message,
        userId: req.user._id,
      });
      res.status(500).json({ error: 'Error updating time format' });
    }
  });

  // Update date format endpoint
  app.post('/settings/update-date-format', ensureAuth, async (req, res) => {
    try {
      const { dateFormat } = req.body;
      if (!['MM/DD/YYYY', 'DD/MM/YYYY'].includes(dateFormat)) {
        return res.status(400).json({ error: 'Invalid date format' });
      }

      users.update(
        { _id: req.user._id },
        { $set: { dateFormat, updatedAt: new Date() } },
        {},
        (err) => {
          if (err) {
            logger.error('Error updating date format', {
              error: err.message,
              userId: req.user._id,
            });
            return res
              .status(500)
              .json({ error: 'Error updating date format' });
          }

          req.user.dateFormat = dateFormat;
          req.session.save((err) => {
            if (err) logger.error('Session save error', { error: err.message });
            res.json({ success: true });
          });

          logger.info(
            `User ${req.user.email} updated date format to ${dateFormat}`
          );
        }
      );
    } catch (error) {
      logger.error('Update date format error', {
        error: error.message,
        userId: req.user._id,
      });
      res.status(500).json({ error: 'Error updating date format' });
    }
  });

  // Update preferred music service endpoint
  app.post('/settings/update-music-service', ensureAuth, async (req, res) => {
    try {
      const { musicService } = req.body;
      if (musicService && !['spotify', 'tidal'].includes(musicService)) {
        return res.status(400).json({ error: 'Invalid music service' });
      }

      users.update(
        { _id: req.user._id },
        { $set: { musicService: musicService || null, updatedAt: new Date() } },
        {},
        (err) => {
          if (err) {
            logger.error('Error updating music service', {
              error: err.message,
              userId: req.user._id,
            });
            return res
              .status(500)
              .json({ error: 'Error updating music service' });
          }

          req.user.musicService = musicService || null;
          req.session.save((err) => {
            if (err) logger.error('Session save error', { error: err.message });
            res.json({ success: true });
          });

          logger.info(
            `User ${req.user.email} updated music service to ${musicService}`
          );
        }
      );
    } catch (error) {
      logger.error('Update music service error', {
        error: error.message,
        userId: req.user._id,
      });
      res.status(500).json({ error: 'Error updating music service' });
    }
  });

  function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);

    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) {
      const hours = Math.floor(seconds / 3600);
      return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
    }
    if (seconds < 2592000) {
      const days = Math.floor(seconds / 86400);
      return days === 1 ? '1 day ago' : `${days} days ago`;
    }

    // For "recent activity", cap at months - anything older isn't really "recent"
    const months = Math.floor(seconds / 2592000);
    if (months === 0) return '< 1 month ago';
    if (months === 1) return '1 month ago';
    if (months < 12) return `${months} months ago`;

    // For anything over a year, just show "over a year ago" for recent activity
    return 'over a year ago';
  }

  // Change password endpoint
  app.post(
    '/settings/change-password',
    ensureAuth,
    sensitiveSettingsRateLimit,
    csrfProtection,
    async (req, res) => {
      try {
        const { currentPassword, newPassword, confirmPassword } = req.body;

        // Validate inputs
        if (!currentPassword || !newPassword || !confirmPassword) {
          if (req.accepts('json')) {
            return res.status(400).json({ error: 'All fields are required' });
          }
          req.flash('error', 'All fields are required');
          return res.redirect('/settings');
        }

        if (newPassword !== confirmPassword) {
          if (req.accepts('json')) {
            return res.status(400).json({ error: 'New passwords do not match' });
          }
          req.flash('error', 'New passwords do not match');
          return res.redirect('/settings');
        }

        if (!isValidPassword(newPassword)) {
          if (req.accepts('json')) {
            return res.status(400).json({ error: 'New password must be at least 8 characters' });
          }
          req.flash('error', 'New password must be at least 8 characters');
          return res.redirect('/settings');
        }

        // Verify current password
        const isMatch = await bcrypt.compare(currentPassword, req.user.hash);
        if (!isMatch) {
          if (req.accepts('json')) {
            return res.status(400).json({ error: 'Current password is incorrect' });
          }
          req.flash('error', 'Current password is incorrect');
          return res.redirect('/settings');
        }

        // Hash new password
        const newHash = await bcrypt.hash(newPassword, 12);

        // Update user
        users.update(
          { _id: req.user._id },
          { $set: { hash: newHash, updatedAt: new Date() } },
          {},
          (err) => {
            if (err) {
              logger.error('Error updating password', {
                error: err.message,
                userId: req.user._id,
              });
              if (req.accepts('json')) {
                return res.status(500).json({ error: 'Error updating password' });
              }
              req.flash('error', 'Error updating password');
              return res.redirect('/settings');
            }

            if (req.accepts('json')) {
              return res.json({ success: true, message: 'Password updated successfully' });
            }
            req.flash('success', 'Password updated successfully');
            res.redirect('/settings');
          }
        );
      } catch (error) {
        logger.error('Password change error', {
          error: error.message,
          userId: req.user._id,
        });
        if (req.accepts('json')) {
          return res.status(500).json({ error: 'Error changing password' });
        }
        req.flash('error', 'Error changing password');
        res.redirect('/settings');
      }
    }
  );

  // Admin request endpoint
  app.post(
    '/settings/request-admin',
    ensureAuth,
    csrfProtection,
    rateLimitAdminRequest,
    async (req, res) => {
      logger.info('Admin request received', {
        email: req.user.email,
        userId: req.user._id,
        requestId: req.id,
      });

      try {
        const { code } = req.body;

        // Validate code
        if (
          !code ||
          code.toUpperCase() !== adminCode ||
          new Date() > adminCodeExpiry
        ) {
          logger.info('Invalid code attempt');

          // Increment failed attempts
          const attempts = req.adminAttempts;
          attempts.count++;
          adminCodeAttempts.set(req.user._id, attempts);

          if (req.accepts('json')) {
            return res.status(400).json({ error: 'Invalid or expired admin code' });
          }
          req.flash('error', 'Invalid or expired admin code');
          return res.redirect('/settings');
        }

        // Clear failed attempts on success
        adminCodeAttempts.delete(req.user._id);

        // Grant admin
        users.update(
          { _id: req.user._id },
          {
            $set: {
              role: 'admin',
              adminGrantedAt: new Date(),
            },
          },
          {},
          (err, _numUpdated) => {
            if (err) {
              logger.error('Error granting admin', {
                error: err.message,
                userId: req.user._id,
              });
              if (req.accepts('json')) {
                return res.status(500).json({ error: 'Error granting admin access' });
              }
              req.flash('error', 'Error granting admin access');
              return res.redirect('/settings');
            }

            logger.info(`✅ Admin access granted to: ${req.user.email}`);

            // Track code usage
            deps.lastCodeUsedBy = req.user.email;
            deps.lastCodeUsedAt = Date.now();

            // REGENERATE CODE IMMEDIATELY after successful use
            logger.info('🔄 Regenerating admin code after successful use...');
            generateAdminCode();

            // Update the session
            req.user.role = 'admin';
            req.session.save((err) => {
              if (err)
                logger.error('Session save error', { error: err.message });
              if (req.accepts('json')) {
                return res.json({ success: true, message: 'Admin access granted!' });
              }
              req.flash('success', 'Admin access granted!');
              res.redirect('/settings');
            });
          }
        );
      } catch (error) {
        logger.error('Admin request error', {
          error: error.message,
          userId: req.user._id,
        });
        if (req.accepts('json')) {
          return res.status(500).json({ error: 'Error processing admin request' });
        }
        req.flash('error', 'Error processing admin request');
        res.redirect('/settings');
      }
    }
  );

  // Update email endpoint
  app.post('/settings/update-email', ensureAuth, async (req, res) => {
    try {
      const { email } = req.body;

      // Validate email
      if (!email || !email.trim()) {
        return res.status(400).json({ error: 'Email is required' });
      }

      if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }

      // Check if email is already taken by another user
      users.findOne(
        { email, _id: { $ne: req.user._id } },
        (err, existingUser) => {
          if (err) {
            logger.error('Database error', {
              error: err.message,
              operation: 'findOne',
            });
            return res.status(500).json({ error: 'Database error' });
          }

          if (existingUser) {
            return res.status(400).json({ error: 'Email already in use' });
          }

          // Update user email
          users.update(
            { _id: req.user._id },
            { $set: { email: email.trim(), updatedAt: new Date() } },
            {},
            (err) => {
              if (err) {
                logger.error('Error updating email', {
                  error: err.message,
                  userId: req.user._id,
                });
                return res.status(500).json({ error: 'Error updating email' });
              }

              // Update session
              req.user.email = email.trim();
              req.session.save((err) => {
                if (err)
                  logger.error('Session save error', { error: err.message });
                req.flash('success', 'Email updated successfully');
                res.json({ success: true });
              });
            }
          );
        }
      );
    } catch (error) {
      logger.error('Update email error', {
        error: error.message,
        userId: req.user._id,
      });
      res.status(500).json({ error: 'Error updating email' });
    }
  });

  // Update username endpoint
  app.post('/settings/update-username', ensureAuth, async (req, res) => {
    try {
      const { username } = req.body;

      // Validate username
      if (!username || !username.trim()) {
        return res.status(400).json({ error: 'Username is required' });
      }

      if (!isValidUsername(username)) {
        return res.status(400).json({
          error:
            'Username can only contain letters, numbers, and underscores and must be 3-30 characters',
        });
      }

      // Check if username is already taken by another user
      users.findOne(
        { username, _id: { $ne: req.user._id } },
        (err, existingUser) => {
          if (err) {
            logger.error('Database error', {
              error: err.message,
              operation: 'findOne',
            });
            return res.status(500).json({ error: 'Database error' });
          }

          if (existingUser) {
            return res.status(400).json({ error: 'Username already taken' });
          }

          // Update username
          users.update(
            { _id: req.user._id },
            { $set: { username: username.trim(), updatedAt: new Date() } },
            {},
            (err) => {
              if (err) {
                logger.error('Error updating username', {
                  error: err.message,
                  userId: req.user._id,
                });
                return res
                  .status(500)
                  .json({ error: 'Error updating username' });
              }

              // Update session
              req.user.username = username.trim();
              req.session.save((err) => {
                if (err)
                  logger.error('Session save error', { error: err.message });
                req.flash('success', 'Username updated successfully');
                res.json({ success: true });
              });
            }
          );
        }
      );
    } catch (error) {
      logger.error('Update username error', {
        error: error.message,
        userId: req.user._id,
      });
      res.status(500).json({ error: 'Error updating username' });
    }
  });

  // ============ EXTENSION AUTHENTICATION ============

  // Extension login page - redirects user to login, then generates token
  app.get('/extension/auth', (req, res) => {
    if (!req.isAuthenticated()) {
      // Save the extension auth intent in session
      req.session.extensionAuth = true;
      // Force session save before redirect to ensure flag persists
      req.session.save((err) => {
        if (err) {
          logger.error('Session save error:', err);
        }
        res.redirect('/login');
      });
      return;
    }

    // User is already logged in, render token generation page
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize SuShe Extension</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #000;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .container {
      max-width: 500px;
      padding: 40px;
      text-align: center;
    }
    h1 {
      font-size: 32px;
      margin: 0 0 16px 0;
      color: #dc2626;
    }
    p {
      font-size: 16px;
      line-height: 1.6;
      color: #9ca3af;
      margin: 0 0 24px 0;
    }
    .success {
      padding: 16px;
      background: #065f46;
      border-radius: 8px;
      margin-bottom: 24px;
      font-size: 14px;
      color: #d1fae5;
    }
    .token-box {
      padding: 16px;
      background: #1f2937;
      border: 1px solid #374151;
      border-radius: 8px;
      margin-bottom: 24px;
      word-break: break-all;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      color: #60a5fa;
    }
    button {
      padding: 12px 24px;
      background: #dc2626;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
      width: 100%;
      margin-bottom: 12px;
    }
    button:hover {
      background: #b91c1c;
    }
    button:disabled {
      background: #374151;
      cursor: not-allowed;
    }
    .info {
      font-size: 14px;
      color: #6b7280;
      margin-top: 24px;
    }
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid #fff;
      border-radius: 50%;
      border-top-color: transparent;
      animation: spin 0.6s linear infinite;
      margin-right: 8px;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🤘 Authorize Browser Extension</h1>
    <p>Click the button below to authorize the SuShe Online browser extension.</p>
    
    <div id="status"></div>
    
    <button id="authorizeBtn" onclick="generateToken()">
      Authorize Extension
    </button>
    
    <div class="info">
      This will generate a secure token that allows your browser extension to access your SuShe lists.
      You can revoke this access anytime from your settings page.
    </div>
  </div>

  <script>
    async function generateToken() {
      const btn = document.getElementById('authorizeBtn');
      const status = document.getElementById('status');
      
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>Generating token...';
      status.innerHTML = '';
      
      try {
        const response = await fetch('/api/auth/extension-token', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        if (!response.ok) {
          throw new Error('Failed to generate token');
        }
        
        const data = await response.json();
        
        status.innerHTML = \`
          <div class="success">
            ✓ Authorization successful!
            <br><br>
            Connecting to extension...
          </div>
        \`;
        
        btn.innerHTML = 'Authorization Complete';
        
        // Dispatch custom event for content script to receive token
        window.dispatchEvent(new CustomEvent('sushe-auth-complete', {
          detail: {
            token: data.token,
            expiresAt: data.expiresAt
          }
        }));
        
        // Give the extension time to pick up the event
        setTimeout(() => {
          status.innerHTML = \`
            <div class="success">
              ✓ Extension should now be authorized!
              <br><br>
              You can close this window.
            </div>
          \`;
          
          // Auto-close after another 2 seconds
          setTimeout(() => {
            window.close();
          }, 2000);
        }, 500);
        
      } catch (error) {
        console.error('Error generating token:', error);
        status.innerHTML = \`
          <div style="padding: 16px; background: #7f1d1d; border-radius: 8px; margin-bottom: 24px; color: #fecaca;">
            ✗ Failed to generate token. Please try again.
          </div>
        \`;
        btn.disabled = false;
        btn.innerHTML = 'Retry';
      }
    }
  </script>
</body>
</html>
    `);
  });

  // ============ EXTENSION TOKEN ENDPOINTS ============

  const {
    generateExtensionToken,
    validateExtensionToken,
    cleanupExpiredTokens,
  } = require('../auth-utils');

  // Generate a new extension token (requires active session)
  app.post('/api/auth/extension-token', ensureAuth, async (req, res) => {
    try {
      const token = generateExtensionToken();
      const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days
      const userAgent = req.get('User-Agent') || 'Unknown';

      await pool.query(
        `INSERT INTO extension_tokens (user_id, token, expires_at, user_agent)
         VALUES ($1, $2, $3, $4)`,
        [req.user._id, token, expiresAt, userAgent]
      );

      logger.info('Extension token generated', {
        userId: req.user._id,
        email: req.user.email,
      });

      res.json({
        token,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (error) {
      logger.error('Error generating extension token', {
        error: error.message,
        userId: req.user._id,
      });
      res.status(500).json({ error: 'Error generating token' });
    }
  });

  // Validate extension token (for testing)
  app.get('/api/auth/validate-token', async (req, res) => {
    try {
      const authHeader = req.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
      }

      const token = authHeader.substring(7);
      const userId = await validateExtensionToken(token, pool);

      if (!userId) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      const user = await usersAsync.findOne({ _id: userId });
      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }

      res.json({
        valid: true,
        user: sanitizeUser(user),
      });
    } catch (error) {
      logger.error('Error validating token', { error: error.message });
      res.status(500).json({ error: 'Error validating token' });
    }
  });

  // Revoke extension token
  app.delete('/api/auth/extension-token', ensureAuth, async (req, res) => {
    try {
      const { token } = req.body;

      if (!token) {
        return res.status(400).json({ error: 'Token required' });
      }

      // Only allow users to revoke their own tokens
      const result = await pool.query(
        `UPDATE extension_tokens 
         SET is_revoked = TRUE 
         WHERE token = $1 AND user_id = $2`,
        [token, req.user._id]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Token not found' });
      }

      logger.info('Extension token revoked', {
        userId: req.user._id,
        email: req.user.email,
      });

      res.json({ success: true });
    } catch (error) {
      logger.error('Error revoking token', {
        error: error.message,
        userId: req.user._id,
      });
      res.status(500).json({ error: 'Error revoking token' });
    }
  });

  // List user's extension tokens
  app.get('/api/auth/extension-tokens', ensureAuth, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, created_at, last_used_at, expires_at, user_agent, is_revoked
         FROM extension_tokens 
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [req.user._id]
      );

      res.json({ tokens: result.rows });
    } catch (error) {
      logger.error('Error listing tokens', {
        error: error.message,
        userId: req.user._id,
      });
      res.status(500).json({ error: 'Error listing tokens' });
    }
  });

  // Cleanup expired tokens (can be called periodically or manually)
  app.post('/api/auth/cleanup-tokens', ensureAuth, async (req, res) => {
    try {
      // Only allow admins to cleanup all tokens
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const deletedCount = await cleanupExpiredTokens(pool);

      logger.info('Cleaned up expired tokens', { count: deletedCount });

      res.json({ deletedCount });
    } catch (error) {
      logger.error('Error cleaning up tokens', { error: error.message });
      res.status(500).json({ error: 'Error cleaning up tokens' });
    }
  });
};
