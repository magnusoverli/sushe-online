module.exports = (app, deps) => {
  const path = require('path');
  const { htmlTemplate, registerTemplate, loginTemplate, forgotPasswordTemplate, resetPasswordTemplate, invalidTokenTemplate, spotifyTemplate, settingsTemplate, isTokenValid, csrfProtection, ensureAuth, ensureAuthAPI, ensureAdmin, rateLimitAdminRequest, users, lists, usersAsync, listsAsync, upload, bcrypt, crypto, nodemailer, composeForgotPasswordEmail, isValidEmail, isValidUsername, isValidPassword, broadcastListUpdate, listSubscribers, sanitizeUser, adminCodeAttempts, adminCode, adminCodeExpiry, generateAdminCode, lastCodeUsedBy, lastCodeUsedAt, dataDir, pool, passport, ready } = deps;

// ============ ROUTES ============

// Registration routes
app.get('/register', csrfProtection, (req, res) => {
  res.send(htmlTemplate(registerTemplate(req, res.locals.flash), 'Join the KVLT - Black Metal Auth'));
});

app.post('/register', csrfProtection, async (req, res) => {
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
      req.flash('error', 'Username can only contain letters, numbers, and underscores and must be 3-30 characters');
      return res.redirect('/register');
    }

    // Validate password length
    if (!isValidPassword(password)) {
      req.flash('error', 'Password must be at least 8 characters');
      return res.redirect('/register');
    }
    
    // Check if email already exists
      email = email.toLowerCase();
      users.findOne({ email }, async (err, existingEmailUser) => {
      if (err) {
        console.error('Database error during registration:', err);
        req.flash('error', 'Registration error. Please try again.');
        return res.redirect('/register');
      }
      
      if (existingEmailUser) {
        req.flash('error', 'Email already registered');
        return res.redirect('/register');
      }
      
      // Check if username already exists
      users.findOne({ username }, async (err, existingUsernameUser) => {
        if (err) {
          console.error('Database error during registration:', err);
          req.flash('error', 'Registration error. Please try again.');
          return res.redirect('/register');
        }
        
        if (existingUsernameUser) {
          req.flash('error', 'Username already taken');
          return res.redirect('/register');
        }
        
        try {
          // Hash the password
          const hash = await bcrypt.hash(password, 12);
          
          // Create the new user
          users.insert({
            email,
            username,
            hash,
            spotifyAuth: null,
            tidalAuth: null,
            tidalCountry: null,
            accentColor: '#dc2626',
            dateFormat: 'YYYY-MM-DD',
            lastActiveAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
          }, (err, newUser) => {
            if (err) {
              console.error('Insert error during registration:', err);
              req.flash('error', 'Registration error. Please try again.');
              return res.redirect('/register');
            }
            
            console.log('New user registered:', email, 'username:', username);
            req.flash('success', 'Registration successful! Please login.');
            res.redirect('/login');
          });
        } catch (hashErr) {
          console.error('Password hashing error during registration:', hashErr);
          req.flash('error', 'Registration error. Please try again.');
          res.redirect('/register');
        }
      });
    });
  } catch (error) {
    console.error('Registration error:', error);
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
        console.error('Error updating last selected list:', err);
        return res.status(500).json({ error: 'Error updating last selected list' });
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
  res.send(htmlTemplate(loginTemplate(req, res.locals.flash), 'SuShe Online'));
});

app.post('/login', csrfProtection, (req, res, next) => {
  console.log('Login POST request received for:', req.body.email);
  
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      console.error('Authentication error:', err);
      req.flash('error', 'An error occurred during login');
      return res.redirect('/login');
    }
    
    if (!user) {
      console.log('Authentication failed:', info);
      req.flash('error', info.message || 'Invalid credentials');
      return res.redirect('/login');
    }
    
    user.lastActiveAt = new Date();

    req.logIn(user, (err) => {
      if (err) {
        console.error('Login error:', err);
        req.flash('error', 'Login failed');
        return res.redirect('/login');
      }
      
      console.log('User logged in successfully:', user.email);

      // Update last active timestamp
      users.update({ _id: user._id }, { $set: { lastActiveAt: user.lastActiveAt } }, () => {});

      // Force session save and handle errors
      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err);
          // Continue anyway - session might still work
        }
        return res.redirect('/');
      });
    });
  })(req, res, next);
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
    const userStats = {
      listCount: userLists.length,
      totalAlbums: userLists.reduce((sum, l) => sum + (Array.isArray(l.data) ? l.data.length : 0), 0)
    };
    
    // If admin, get admin data
    let adminData = null;
    let stats = null;
    
    if (req.user.role === 'admin') {
      const allUsers = await usersAsync.find({});
      const usersWithCounts = await Promise.all(allUsers.map(async (user) => ({
        ...user,
        listCount: await listsAsync.count({ userId: user._id })
      })));
      const allLists = await listsAsync.find({});

      let totalAlbums = 0;
      const genreCounts = new Map();

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      let activeUsers = 0;

      const twoWeeksAgo = new Date();
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

      const usersThisWeek = allUsers.filter(u => new Date(u.createdAt) >= sevenDaysAgo).length;
      const usersLastWeek = allUsers.filter(u => {
        const createdAt = new Date(u.createdAt);
        return createdAt >= twoWeeksAgo && createdAt < sevenDaysAgo;
      }).length;

      const userGrowth = usersLastWeek > 0
        ? Math.round(((usersThisWeek - usersLastWeek) / usersLastWeek) * 100)
        : (usersThisWeek > 0 ? 100 : 0);

      allLists.forEach(list => {
        if (list.updatedAt && new Date(list.updatedAt) >= sevenDaysAgo) {
          const userIndex = allUsers.findIndex(u => u._id === list.userId);
          if (userIndex !== -1 && !allUsers[userIndex].counted) {
            allUsers[userIndex].counted = true;
            activeUsers++;
          }
        }

        if (Array.isArray(list.data)) {
          totalAlbums += list.data.length;
          list.data.forEach(album => {
            if (album.genre_1 || album.genre) {
              const genre = album.genre_1 || album.genre;
              if (genre && genre !== '' && genre !== 'Genre 1') {
                genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
              }
            }

            if (album.genre_2 && album.genre_2 !== '' && album.genre_2 !== 'Genre 2' && album.genre_2 !== '-') {
              genreCounts.set(album.genre_2, (genreCounts.get(album.genre_2) || 0) + 1);
            }
          });
        }
      });

              // Get top genres
              const topGenres = Array.from(genreCounts.entries())
                .map(([name, count]) => ({ name, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 5);

              // Get top users by list count
              const topUsers = usersWithCounts
                .filter(u => u.listCount > 0)
                .sort((a, b) => b.listCount - a.listCount)
                .slice(0, 5);

              // Calculate database size
              let dbSize = 'N/A';
              try {
                const { rows } = await pool.query(
                  "SELECT pg_size_pretty(pg_database_size(current_database())) AS size"
                );
                dbSize = rows[0].size;
              } catch (e) {
                console.error('Error calculating DB size:', e);
              }

              // Count active sessions
              let activeSessions = 0;
              try {
                const sessionPath = path.join(dataDir, 'sessions');
                if (require('fs').existsSync(sessionPath)) {
                  const sessionFiles = require('fs').readdirSync(sessionPath);
                  activeSessions = sessionFiles.filter(f => f.endsWith('.json')).length;
                }
              } catch (e) {
                console.error('Error counting sessions:', e);
              }

      stats = {
        totalUsers: allUsers.length,
        totalLists: allLists.length,
        totalAlbums,
        adminUsers: allUsers.filter(u => u.role === 'admin').length,
        activeUsers,
        userGrowth,
        dbSize,
        activeSessions,
        topGenres,
        topUsers
      };

              // Generate real recent activity based on actual data
              const recentActivity = [];
              
              // Find recent user registrations
              const recentUsers = allUsers
                .filter(u => u.createdAt)
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .slice(0, 2);
              
              recentUsers.forEach(user => {
                const timeAgo = getTimeAgo(new Date(user.createdAt));
                recentActivity.push({
                  icon: 'fa-user-plus',
                  color: 'green',
                  message: `New user: ${user.username}`,
                  time: timeAgo
                });
              });
              
              // Find recent list creations
              const recentLists = allLists
                .filter(l => l.createdAt)
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .slice(0, 2);
              
              recentLists.forEach(list => {
                const timeAgo = getTimeAgo(new Date(list.createdAt));
                recentActivity.push({
                  icon: 'fa-list',
                  color: 'blue',
                  message: `New list: ${list.name}`,
                  time: timeAgo
                });
              });
              
              // Find recent admin grants
              const recentAdmins = allUsers
                .filter(u => u.role === 'admin' && u.adminGrantedAt)
                .sort((a, b) => new Date(b.adminGrantedAt) - new Date(a.adminGrantedAt))
                .slice(0, 1);
              
              recentAdmins.forEach(admin => {
                const timeAgo = getTimeAgo(new Date(admin.adminGrantedAt));
                recentActivity.push({
                  icon: 'fa-user-shield',
                  color: 'yellow',
                  message: `Admin granted: ${admin.username}`,
                  time: timeAgo
                });
              });
              
              // Sort by time and take the most recent 4
              recentActivity.sort((a, b) => {
                // This is a simplified sort - in production you'd want to store actual timestamps
                const timeValues = { 'just now': 0, 'minutes ago': 1, 'hour': 2, 'hours ago': 3, 'day': 4, 'days ago': 5 };
                const aValue = Object.keys(timeValues).find(key => a.time.includes(key)) || 6;
                const bValue = Object.keys(timeValues).find(key => b.time.includes(key)) || 6;
                return timeValues[aValue] - timeValues[bValue];
              });
              
              // Ensure we have at least 4 items (pad with defaults if needed)
              while (recentActivity.length < 4) {
                recentActivity.push({
                  icon: 'fa-clock',
                  color: 'gray',
                  message: 'No recent activity',
                  time: '-'
                });
              }

      adminData = {
        users: usersWithCounts,
        stats,
        recentActivity: recentActivity.slice(0, 4)
      };
    }

    res.send(settingsTemplate(req, {
      user: sanitized,
      userStats,
      stats,
      adminData,
      flash: res.locals.flash,
      spotifyValid,
      tidalValid
    }));
    
  } catch (error) {
    console.error('Settings page error:', error);
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
      return res.status(400).json({ error: 'Invalid color format. Please use hex format (#RRGGBB)' });
    }
    
    // Update user's accent color
    users.update(
      { _id: req.user._id },
      { $set: { accentColor, updatedAt: new Date() } },
      {},
      (err) => {
        if (err) {
          console.error('Error updating accent color:', err);
          return res.status(500).json({ error: 'Error updating theme color' });
        }
        
        // Update session
        req.user.accentColor = accentColor;
        req.session.save((err) => {
          if (err) console.error('Session save error:', err);
          res.json({ success: true });
        });
        
        console.log(`User ${req.user.email} updated accent color to ${accentColor}`);
      }
    );
  } catch (error) {
    console.error('Update accent color error:', error);
    res.status(500).json({ error: 'Error updating theme color' });
  }
});

// Update date format endpoint
app.post('/settings/update-date-format', ensureAuth, async (req, res) => {
  try {
    const { dateFormat } = req.body;
    const validFormats = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'];
    if (!validFormats.includes(dateFormat)) {
      return res.status(400).json({ error: 'Invalid date format' });
    }

    users.update(
      { _id: req.user._id },
      { $set: { dateFormat, updatedAt: new Date() } },
      {},
      (err) => {
        if (err) {
          console.error('Error updating date format:', err);
          return res.status(500).json({ error: 'Error updating date format' });
        }

        req.user.dateFormat = dateFormat;
        req.session.save((err) => {
          if (err) console.error('Session save error:', err);
          res.json({ success: true });
        });

        console.log(`User ${req.user.email} updated date format to ${dateFormat}`);
      }
    );
  } catch (error) {
    console.error('Update date format error:', error);
    res.status(500).json({ error: 'Error updating date format' });
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

// Run migrations once the database is ready
ready.then(() => {
  // One-time migration to add accentColor to existing users
  users.update(
    { accentColor: { $exists: false } },
    { $set: { accentColor: '#dc2626' } },
    { multi: true },
    (err, numUpdated) => {
      if (err) {
        console.error('Error migrating accent colors:', err);
      } else if (numUpdated > 0) {
        console.log(`Migrated ${numUpdated} users with default accent color`);
      }
    }
  );

  // One-time migration to add dateFormat to existing users
  users.update(
    { dateFormat: { $exists: false } },
    { $set: { dateFormat: 'YYYY-MM-DD' } },
    { multi: true },
    (err, numUpdated) => {
      if (err) {
        console.error('Error migrating date formats:', err);
      } else if (numUpdated > 0) {
        console.log(`Migrated ${numUpdated} users with default date format`);
      }
    }
  );

  // Ensure auth fields exist on existing users
  users.update(
    { spotifyAuth: { $exists: false } },
    { $set: { spotifyAuth: null } },
    { multi: true },
    () => {}
  );

  users.update(
    { tidalAuth: { $exists: false } },
    { $set: { tidalAuth: null } },
    { multi: true },
    () => {}
  );

  // Ensure tidalCountry exists on existing users
  users.update(
    { tidalCountry: { $exists: false } },
    { $set: { tidalCountry: null } },
    { multi: true },
    () => {}
  );

});


// Change password endpoint
app.post('/settings/change-password', ensureAuth, csrfProtection, async (req, res) => {
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
          console.error('Error updating password:', err);
          req.flash('error', 'Error updating password');
          return res.redirect('/settings');
        }
        
        req.flash('success', 'Password updated successfully');
        res.redirect('/settings');
      }
    );
  } catch (error) {
    console.error('Password change error:', error);
    req.flash('error', 'Error changing password');
    res.redirect('/settings');
  }
});

// Admin request endpoint
app.post('/settings/request-admin', ensureAuth, csrfProtection, rateLimitAdminRequest, async (req, res) => {
  console.log('Admin request received from:', req.user.email);
  
  try {
    const { code } = req.body;
    
    // Validate code
    if (!code || code.toUpperCase() !== adminCode || new Date() > adminCodeExpiry) {
      console.log('Invalid code attempt');
      
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
          adminGrantedAt: new Date()
        }
      },
      {},
      (err, numUpdated) => {
        if (err) {
          console.error('Error granting admin:', err);
          req.flash('error', 'Error granting admin access');
          return res.redirect('/settings');
        }
        
        console.log(`✅ Admin access granted to: ${req.user.email}`);
        
        // >>>>>>> ADD THE TRACKING CODE HERE <<<<<
        // Track code usage
        lastCodeUsedBy = req.user.email;
        lastCodeUsedAt = Date.now();
        
        // REGENERATE CODE IMMEDIATELY after successful use
        console.log('🔄 Regenerating admin code after successful use...');
        generateAdminCode();
        
        // Update the session
        req.user.role = 'admin';
        req.session.save((err) => {
          if (err) console.error('Session save error:', err);
          req.flash('success', 'Admin access granted!');
          res.redirect('/settings');
        });
      }
    );
  } catch (error) {
    console.error('Admin request error:', error);
    req.flash('error', 'Error processing admin request');
    res.redirect('/settings');
  }
});

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
    users.findOne({ email, _id: { $ne: req.user._id } }, (err, existingUser) => {
      if (err) {
        console.error('Database error:', err);
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
            console.error('Error updating email:', err);
            return res.status(500).json({ error: 'Error updating email' });
          }
          
          // Update session
          req.user.email = email.trim();
          req.session.save((err) => {
            if (err) console.error('Session save error:', err);
            req.flash('success', 'Email updated successfully');
            res.json({ success: true });
          });
        }
      );
    });
  } catch (error) {
    console.error('Update email error:', error);
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
      return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores and must be 3-30 characters' });
    }
    
    // Check if username is already taken by another user
    users.findOne({ username, _id: { $ne: req.user._id } }, (err, existingUser) => {
      if (err) {
        console.error('Database error:', err);
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
            console.error('Error updating username:', err);
            return res.status(500).json({ error: 'Error updating username' });
          }
          
          // Update session
          req.user.username = username.trim();
          req.session.save((err) => {
            if (err) console.error('Session save error:', err);
            req.flash('success', 'Username updated successfully');
            res.json({ success: true });
          });
        }
      );
    });
  } catch (error) {
    console.error('Update username error:', error);
    res.status(500).json({ error: 'Error updating username' });
  }
});

};
