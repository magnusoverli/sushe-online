const express = require('express');
const session = require('express-session');
const { Passport } = require('passport');
const {
  createEnsureAuthAPI,
  recordActivity,
} = require('../../middleware/auth');
const { createCsrfProtection } = require('../../middleware/csrf');
const { createErrorHandler } = require('../../middleware/error-handler');
const { createCorsMiddleware } = require('../../config/security');
const { createMockLogger } = require('../helpers');

const VALID_TOKEN = 'v'.repeat(43);
const EXTENSION_USER = 'extension-user';
const SESSION_USER = 'session-user';

// Real HTTP/session/auth/CSRF/route boundaries; persistence and MusicBrainz
// are in-memory so these regressions never need a live account or database.
function createExtensionAuthApp(overrides = {}) {
  const app = express();
  const logger = createMockLogger();
  const requests = [];
  const mutations = [];
  const activity = [];
  const validatedTokens = [];
  const passport = new Passport();
  const authService = {
    getUserById: async (_id) => ({ _id, approvalStatus: 'approved' }),
    ...overrides.authService,
  };
  const validateExtensionToken =
    overrides.validateExtensionToken ||
    (async (token) => {
      validatedTokens.push(token);
      return token === VALID_TOKEN ? EXTENSION_USER : null;
    });
  passport.serializeUser((user, done) => done(null, user._id));
  passport.deserializeUser((id, done) => done(null, { _id: id }));
  app.use(createCorsMiddleware());
  app.use(express.json());
  app.use(
    session({
      secret: 'extension-auth-test-session-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax' },
    })
  );
  app.use(passport.initialize());
  app.use(passport.session());
  app.post('/test/session/:userId', (req, res, next) => {
    req.login({ _id: req.params.userId }, (error) => {
      if (error) return next(error);
      res.json({ userId: req.user._id });
    });
  });
  app.get('/test/session', (req, res) =>
    res.json({
      userId: req.user?._id,
      lastActivityUpdatedAt: req.session.lastActivityUpdatedAt,
    })
  );
  app.use('/api', (req, res, next) => {
    const observed = {
      path: req.originalUrl.split('?')[0],
      method: req.method,
      hasCookie: Boolean(req.get('Cookie')),
      hasBearer: Boolean(req.get('Authorization')),
    };
    requests.push(observed);
    res.on('finish', () =>
      Object.assign(observed, {
        status: res.statusCode,
        userId: req.user?._id,
        authMethod: req.authMethod,
      })
    );
    next();
  });
  const csrfProtection = createCsrfProtection();
  const ensureAuthAPI = createEnsureAuthAPI({
    authService,
    db: { updateLastActivity: async (userId) => activity.push(userId) },
    validateExtensionToken,
    recordActivity,
    csrfProtection,
    logger,
  });
  app.get('/api/auth/csrf', ensureAuthAPI, csrfProtection, (req, res) => {
    if (!req.csrfToken)
      return res.status(400).json({ error: 'A browser session is required' });
    res.json({ csrfToken: req.csrfToken() });
  });
  app.get('/api/auth/validate-token', ensureAuthAPI, (req, res) =>
    res.json({ valid: true, user: req.user })
  );
  app.get('/api/proxy/musicbrainz', ensureAuthAPI, (req, res) => {
    res.json(
      String(req.query.endpoint).startsWith('artist/')
        ? { country: 'CL' }
        : {
            'release-groups': [
              {
                id: 'album-1',
                'artist-credit': [{ artist: { id: 'artist-1' } }],
              },
            ],
          }
    );
  });
  const albumService = {
    batchUpdate: async (updates, userId) => {
      mutations.push({ operation: 'metadata', userId, updates });
      return updates.length;
    },
    updateSourceObservation: async (albumId, sourceObservation, userId) => {
      mutations.push({
        operation: 'observation',
        userId,
        albumId,
        sourceObservation,
      });
      return { result: { status: 'applied' }, warnings: [] };
    },
  };
  require('../../routes/api/lists')(app, {
    ensureAuthAPI,
    logger,
    albumService,
    cacheConfigs: { userSpecific: (_req, _res, next) => next() },
    helpers: { triggerAggregateListRecompute() {}, invalidateListCaches() {} },
    listService: {
      getAllLists: async (userId) => ({
        [`${userId}-list`]: { name: `${userId} list`, count: 0 },
      }),
      getAlbumPresence: async () => [],
      incrementalUpdate: async (id, userId, { added = [] }) => {
        mutations.push({ operation: 'add', userId, id, added });
        return {
          list: { _id: id, revision: '1' },
          addedItems: added,
          changeCount: added.length,
          duplicateAlbums: [],
        };
      },
      ...overrides.listService,
    },
  });
  require('../../routes/api/albums')(app, {
    ensureAuthAPI,
    logger,
    albumService,
  });
  app.use(createErrorHandler(logger));
  return { app, requests, mutations, activity, validatedTokens };
}

module.exports = {
  createExtensionAuthApp,
  VALID_TOKEN,
  EXTENSION_USER,
  SESSION_USER,
};
