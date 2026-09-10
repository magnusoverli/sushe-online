/**
 * Passport Authentication Configuration
 *
 * Configures Passport.js with LocalStrategy for email/password authentication.
 * Reads current authentication state during deserialization.
 */

const LocalStrategy = require('passport-local').Strategy;
const logger = require('../utils/logger');
const {
  serializeIdentity,
  resolveSessionIdentity,
} = require('../services/session-identity');

// Existing mutation callers retain this hook; authentication reads are now fresh.
function invalidateUserCache(_userId) {}

/**
 * Configure Passport with LocalStrategy and serialization.
 * @param {Object} passport - Passport instance
 * @param {Object} deps - Dependencies
 * @param {Object} deps.authService - Auth service with user lookup helpers
 * @param {Object} deps.bcrypt - bcrypt module
 */
function configurePassport(passport, { authService, bcrypt }) {
  if (!authService) {
    throw new Error('configurePassport requires deps.authService');
  }

  passport.use(
    new LocalStrategy(
      { usernameField: 'email' },
      async (email, password, done) => {
        logger.info('Login attempt', { email });

        try {
          const user = await authService.getUserByEmail(email);

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

  passport.serializeUser((user, done) => done(null, serializeIdentity(user)));
  passport.deserializeUser(async (identity, done) => {
    try {
      // Authentication and credential state must not be served from a TTL cache.
      const user = await resolveSessionIdentity(identity, authService);
      done(null, user);
    } catch (err) {
      done(err);
    }
  });
}

module.exports = { configurePassport, invalidateUserCache };
