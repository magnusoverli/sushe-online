/**
 * Passport Authentication Configuration
 *
 * Configures Passport.js with LocalStrategy for email/password authentication.
 * Includes a user cache layer to reduce database queries during deserialization.
 */

const LocalStrategy = require('passport-local').Strategy;
const logger = require('../utils/logger');

// ============ USER CACHE FOR PASSPORT DESERIALIZATION ============
// Reduces database queries by caching user objects with 5-minute TTL
const userCache = new Map();
const USER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const USER_CACHE_MAX_SIZE = 1000; // Maximum cached users to prevent unbounded growth

function getCachedUser(id) {
  const cached = userCache.get(id);
  if (cached && Date.now() - cached.timestamp < USER_CACHE_TTL) {
    return cached.user;
  }
  userCache.delete(id);
  return null;
}

function setCachedUser(id, user) {
  // Evict oldest entry if cache is full
  if (userCache.size >= USER_CACHE_MAX_SIZE) {
    const firstKey = userCache.keys().next().value;
    userCache.delete(firstKey);
  }
  userCache.set(id, { user, timestamp: Date.now() });
}

/**
 * Invalidate user cache entry - call when user data changes
 * @param {string} userId - User ID to invalidate
 */
function invalidateUserCache(userId) {
  userCache.delete(userId);
}

/**
 * Configure Passport with LocalStrategy and serialization.
 * @param {Object} passport - Passport instance
 * @param {Object} deps - Dependencies
 * @param {Object} deps.usersAsync - Async user datastore
 * @param {Object} deps.bcrypt - bcrypt module
 */
function configurePassport(passport, { usersAsync, bcrypt }) {
  passport.use(
    new LocalStrategy(
      { usernameField: 'email' },
      async (email, password, done) => {
        logger.info('Login attempt', { email });

        try {
          const user = await usersAsync.findOne({ email });

          // TIMING ATTACK MITIGATION:
          // Always perform bcrypt comparison, even for non-existent users.
          // This ensures constant-time response regardless of whether the email exists.
          let isMatch = false;

          if (!user) {
            // User doesn't exist - compare against a dummy hash to maintain constant timing
            // This prevents attackers from using timing analysis to enumerate valid emails
            const dummyHash =
              '$2a$12$ZIJfCqcmsmY3xNqmJGFJh.vKMF3rKXSgPp/mDgpjLfSUJJ1oiGdX.'; // Pre-computed bcrypt hash
            await bcrypt.compare(password, dummyHash);
            logger.warn('Login failed: Unknown email', { email });
          } else {
            logger.debug('User found', {
              email: user.email,
              hasHash: !!user.hash,
            });
            isMatch = await bcrypt.compare(password, user.hash);
          }

          // Always return the same message regardless of whether email or password was wrong
          if (isMatch && user) {
            // Check approval status before allowing login
            // Treat null/undefined as 'approved' for backwards compatibility with existing users
            const approvalStatus = user.approvalStatus || 'approved';

            if (approvalStatus === 'pending') {
              logger.warn('Login blocked: Account pending approval', { email });
              return done(null, false, {
                message: 'Your account is pending admin approval',
              });
            }

            if (approvalStatus === 'rejected') {
              logger.warn('Login blocked: Registration rejected', { email });
              return done(null, false, {
                message: 'Your registration was not approved',
              });
            }

            logger.info('Login successful', { email });
            return done(null, user);
          } else {
            logger.warn('Login failed: Invalid credentials', { email });
            return done(null, false, { message: 'Invalid email or password' });
          }
        } catch (err) {
          logger.error('Database error during login', {
            error: err.message,
          });
          return done(err);
        }
      }
    )
  );

  passport.serializeUser((user, done) => done(null, user._id));
  passport.deserializeUser(async (id, done) => {
    try {
      // Check user cache first to avoid database query on every request
      let user = getCachedUser(id);
      if (!user) {
        user = await usersAsync.findOne({ _id: id });
        if (user) {
          setCachedUser(id, user);
        }
      }
      done(null, user);
    } catch (err) {
      done(err);
    }
  });
}

module.exports = { configurePassport, invalidateUserCache };
