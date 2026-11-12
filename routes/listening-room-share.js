const express = require('express');
const { createRateLimiter } = require('../middleware/rate-limit');
const { escapeHtml } = require('../utils/escape-html');

function page(body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Shared list · SuShe Online</title></head><body><main>${body}</main></body></html>`;
}

function wantsJson(req) {
  return /(?:^|[,;\s])application\/json(?:$|[,;\s])/i.test(
    req.get('Accept') || ''
  );
}

function notFound(req, res) {
  res.status(404);
  return wantsJson(req)
    ? res.json({ error: 'not_found' })
    : res
        .type('html')
        .send(
          page(
            '<p>This link no longer works. Ask the owner to share the list again.</p>'
          )
        );
}

module.exports = (app, { listeningRoomShareService, logger }) => {
  const router = express.Router();
  router.use((_req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
    });
    next();
  });
  // Keep bearer tokens out of limiter logs/metrics; still key by client IP.
  const limiter = createRateLimiter({
    windowMs: 60 * 1000,
    envVar: 'RATE_LIMIT_LISTENING_ROOM_MAX',
    defaultMax: 60,
    handlerMessage: 'Too many requests. Please try again in a minute.',
    pathLabel: '/lr/:token',
  });
  router.use(limiter);
  router.get('/:token', async (req, res) => {
    if (req.method !== 'GET') return res.status(405).end();
    try {
      const payload = await listeningRoomShareService.getPublicPayload(
        req.params.token
      );
      if (!payload) return notFound(req, res);
      if (wantsJson(req)) return res.json(payload);
      const count = payload.songs.length;
      res
        .type('html')
        .send(
          page(
            `<h1>${escapeHtml(payload.list.name)}</h1><p>${count} ${count === 1 ? 'song' : 'songs'}.</p><p>Works until ${escapeHtml(payload.expiresAt)}.</p><p>Paste this link into Doom Room → Your playlist → Import list.</p>`
          )
        );
    } catch {
      logger.error('Failed to read Doom Room share');
      res.status(500).json({ error: 'internal_error' });
    }
  });
  // End all /lr/ requests here, before sessions, redirects and CORS.
  router.use(notFound);
  // Includes Express's malformed URI decoding errors, without logging tokens.
  router.use((_error, req, res, _next) => notFound(req, res));
  app.use('/lr', router);
};
