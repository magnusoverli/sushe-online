const express = require('express');
const http = require('node:http');
const https = require('node:https');
const { createHash, timingSafeEqual } = require('node:crypto');
const { configureProxyTrust } = require('../../config/network-trust');
const { publicStatus } = require('./control-store');

function createRecoveryGateway(control, env = process.env) {
  const app = express();
  configureProxyTrust(app, env);
  app.get('/admin/restore/:restoreId/status', async (req, res) => {
    try {
      const job = await control.get(req.params.restoreId);
      const cookie = (req.headers.cookie || '')
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(`restore_${req.params.restoreId}=`));
      const token = cookie
        ? decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1))
        : '';
      const actual = createHash('sha256').update(token).digest();
      const expected = Buffer.from(job?.status_key || '', 'hex');
      if (
        !job ||
        expected.length !== actual.length ||
        !timingSafeEqual(actual, expected)
      )
        return res.sendStatus(403);
      res.set('Cache-Control', 'no-store').json(publicStatus(job));
    } catch {
      res.sendStatus(503);
    }
  });
  const target = new URL(env.RECOVERY_APP_URL || 'http://app:3000');
  app.use(async (req, res) => {
    try {
      const state = await control.state();
      if (
        env.DEPLOYMENT_VERIFY_ONLY === 'true' ||
        !state ||
        state.maintenance ||
        state.operation_id
      )
        return res
          .status(503)
          .set('Retry-After', '5')
          .json({ error: 'Database recovery in progress' });
      const transport = target.protocol === 'https:' ? https : http;
      const upstream = transport.request(
        {
          hostname: target.hostname,
          port: target.port,
          protocol: target.protocol,
          method: req.method,
          path: req.originalUrl,
          headers: {
            ...req.headers,
            host: req.headers.host,
            'x-forwarded-for': req.ip,
            'x-forwarded-proto': req.protocol,
            'x-forwarded-host': req.host,
          },
        },
        (response) => {
          res.writeHead(response.statusCode, response.headers);
          response.pipe(res);
        }
      );
      upstream.setTimeout(600000, () => upstream.destroy());
      upstream.on('error', () => {
        if (!res.headersSent)
          res.status(503).json({ error: 'Application restarting' });
        else res.destroy();
      });
      req.on('aborted', () => upstream.destroy());
      res.on('close', () => {
        if (!res.writableEnded) upstream.destroy();
      });
      req.pipe(upstream);
    } catch {
      res.sendStatus(503);
    }
  });
  return app;
}
module.exports = { createRecoveryGateway };
