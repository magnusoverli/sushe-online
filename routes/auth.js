module.exports = (app, deps) => {
  const logger = require('../utils/logger');
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
    isTokenValid,
    csrfProtection,
    ensureAuth,
    ensureAuthAPI,
    rateLimitAdminRequest,
    users,
    usersAsync,
    listsAsync,
    listItemsAsync,
    _albumsAsync,
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

        // Insert new user
        const _newUser = await usersAsync.insert({
          email,
          username,
          hash,
          spotifyAuth: null,
          tidalAuth: null,
          tidalCountry: null,
          accentColor: '#dc2626',
          timeFormat: '24h',
          dateFormat: 'MM/DD/YYYY',
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        logger.info('New user registered', { email, username });
        req.flash('success', 'Registration successful! Please login.');
        res.redirect('/login');
      } catch (err) {
        logger.error('Database error during registration', {
          error: err.message,
        });
        req.flash('error', 'Registration error. Please try again.');
        return res.redirect('/register');
      }
    } catch (error) {
      logger.error('Registration error', { error: error.message });
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
          logger.error('Error updating last selected list:', err);
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
        logger.info('Authentication failed:', info);
        req.flash('error', info.message || 'Invalid credentials');

        // Force session save before redirect to ensure flash messages persist
        await new Promise((resolve) => {
          req.session.save((err) => {
            if (err) {
              logger.error('Session save error:', err);
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

      // Record last activity
      const timestamp = new Date();
      req.user.lastActivity = timestamp;
      await usersAsync.update(
        { _id: req.user._id },
        { $set: { lastActivity: timestamp } }
      );

      // Force session save and handle errors
      await new Promise((resolve) => {
        req.session.save((err) => {
          if (err) {
            logger.error('Session save error:', err);
            // Continue anyway - session might still work
          }
          resolve();
        });
      });

      return res.redirect('/');
    } catch (err) {
      logger.error('Authentication error', { error: err.message });
      req.flash('error', 'An error occurred during login');
      return res.redirect('/login');
    }
  });

  // Logout
  app.get('/logout', (req, res) => {
    req.logout(() => res.redirect('/login'));
  });

  // Home (protected) - Spotify-like interface
  app.get('/', ensureAuth, (req, res) => {
    res.send(spotifyTemplate(sanitizeUser(req.user)));
  });

  // Unified Settings Page
  app.get('/settings', ensureAuth, csrfProtection, async (req, res) => {
    try {
      const spotifyValid = isTokenValid(req.user.spotifyAuth);
      const tidalValid = isTokenValid(req.user.tidalAuth);

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

      // If admin, get admin data
      let adminData = null;
      let stats = null;

      if (req.user.role === 'admin') {
        const allUsers = await usersAsync.find({});
        const usersWithCounts = await Promise.all(
          allUsers.map(async (user) => ({
            ...user,
            listCount: await listsAsync.count({ userId: user._id }),
          }))
        );
        const allLists = await listsAsync.find({});

        const uniqueAlbumIds = new Set();
        const genreCounts = new Map();

        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        let activeUsers = 0;

        const twoWeeksAgo = new Date();
        twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

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

        for (const list of allLists) {
          const items = await listItemsAsync.find({ listId: list._id });

          if (list.updatedAt && new Date(list.updatedAt) >= sevenDaysAgo) {
            const userIndex = allUsers.findIndex((u) => u._id === list.userId);
            if (userIndex !== -1 && !allUsers[userIndex].counted) {
              allUsers[userIndex].counted = true;
              activeUsers++;
            }
          }

          for (const album of items) {
            // Track unique albums by album_id
            if (album.albumId && album.albumId !== '') {
              uniqueAlbumIds.add(album.albumId);
            }

            const genre = album.genre1;
            if (genre && genre !== '' && genre !== 'Genre 1') {
              genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
            }

            if (
              album.genre2 &&
              album.genre2 !== '' &&
              album.genre2 !== 'Genre 2' &&
              album.genre2 !== '-'
            ) {
              genreCounts.set(
                album.genre2,
                (genreCounts.get(album.genre2) || 0) + 1
              );
            }
          }
        }

        const totalAlbums = uniqueAlbumIds.size;

        // Get top genres
        const topGenres = Array.from(genreCounts.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);

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
          logger.error('Error calculating DB size:', e);
        }

        // Count active sessions from PostgreSQL
        let activeSessions = 0;
        try {
          const { rows } = await pool.query(
            'SELECT COUNT(*) AS count FROM session WHERE expire > NOW()'
          );
          activeSessions = parseInt(rows[0].count, 10);
        } catch (e) {
          logger.error('Error counting sessions:', e);
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
        })
      );
    } catch (error) {
      logger.error('Settings page error:', error);
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
            logger.error('Error updating accent color:', err);
            return res
              .status(500)
              .json({ error: 'Error updating theme color' });
          }

          // Update session
          req.user.accentColor = accentColor;
          req.session.save((err) => {
            if (err) logger.error('Session save error:', err);
            res.json({ success: true });
          });

          logger.info(
            `User ${req.user.email} updated accent color to ${accentColor}`
          );
        }
      );
    } catch (error) {
      logger.error('Update accent color error:', error);
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
            logger.error('Error updating time format:', err);
            return res
              .status(500)
              .json({ error: 'Error updating time format' });
          }

          req.user.timeFormat = timeFormat;
          req.session.save((err) => {
            if (err) logger.error('Session save error:', err);
            res.json({ success: true });
          });

          logger.info(
            `User ${req.user.email} updated time format to ${timeFormat}`
          );
        }
      );
    } catch (error) {
      logger.error('Update time format error:', error);
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
            logger.error('Error updating date format:', err);
            return res
              .status(500)
              .json({ error: 'Error updating date format' });
          }

          req.user.dateFormat = dateFormat;
          req.session.save((err) => {
            if (err) logger.error('Session save error:', err);
            res.json({ success: true });
          });

          logger.info(
            `User ${req.user.email} updated date format to ${dateFormat}`
          );
        }
      );
    } catch (error) {
      logger.error('Update date format error:', error);
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
            logger.error('Error updating music service:', err);
            return res
              .status(500)
              .json({ error: 'Error updating music service' });
          }

          req.user.musicService = musicService || null;
          req.session.save((err) => {
            if (err) logger.error('Session save error:', err);
            res.json({ success: true });
          });

          logger.info(
            `User ${req.user.email} updated music service to ${musicService}`
          );
        }
      );
    } catch (error) {
      logger.error('Update music service error:', error);
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
          req.flash('error', 'All fields are required');
          return res.redirect('/settings');
        }

        if (newPassword !== confirmPassword) {
          req.flash('error', 'New passwords do not match');
          return res.redirect('/settings');
        }

        if (!isValidPassword(newPassword)) {
          req.flash('error', 'New password must be at least 8 characters');
          return res.redirect('/settings');
        }

        // Verify current password
        const isMatch = await bcrypt.compare(currentPassword, req.user.hash);
        if (!isMatch) {
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
              logger.error('Error updating password:', err);
              req.flash('error', 'Error updating password');
              return res.redirect('/settings');
            }

            req.flash('success', 'Password updated successfully');
            res.redirect('/settings');
          }
        );
      } catch (error) {
        logger.error('Password change error:', error);
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
      logger.info('Admin request received from:', req.user.email);

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
              logger.error('Error granting admin:', err);
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
              if (err) logger.error('Session save error:', err);
              req.flash('success', 'Admin access granted!');
              res.redirect('/settings');
            });
          }
        );
      } catch (error) {
        logger.error('Admin request error:', error);
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
            logger.error('Database error:', err);
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
                logger.error('Error updating email:', err);
                return res.status(500).json({ error: 'Error updating email' });
              }

              // Update session
              req.user.email = email.trim();
              req.session.save((err) => {
                if (err) logger.error('Session save error:', err);
                req.flash('success', 'Email updated successfully');
                res.json({ success: true });
              });
            }
          );
        }
      );
    } catch (error) {
      logger.error('Update email error:', error);
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
            logger.error('Database error:', err);
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
                logger.error('Error updating username:', err);
                return res
                  .status(500)
                  .json({ error: 'Error updating username' });
              }

              // Update session
              req.user.username = username.trim();
              req.session.save((err) => {
                if (err) logger.error('Session save error:', err);
                req.flash('success', 'Username updated successfully');
                res.json({ success: true });
              });
            }
          );
        }
      );
    } catch (error) {
      logger.error('Update username error:', error);
      res.status(500).json({ error: 'Error updating username' });
    }
  });
};
