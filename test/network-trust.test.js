const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const express = require('express');
const session = require('express-session');
const request = require('supertest');
const { WebSocket, WebSocketServer } = require('ws');
const { configureProxyTrust } = require('../config/network-trust');
const { createRecoveryGateway } = require('../services/recovery/gateway');
const {
  attachWebsocketProxy,
} = require('../services/recovery/websocket-proxy');

const headers = {
  Host: 'origin.example',
  'X-Forwarded-For': '203.0.113.2, 10.0.0.9',
  'X-Forwarded-Proto': 'https',
  'X-Forwarded-Host': 'public.example',
};
const cases = [
  {
    name: 'published production one-hop default',
    env: { NODE_ENV: 'production' },
    ip: '10.0.0.9',
    forwarded: true,
  },
  {
    name: 'explicit proxy chain',
    env: { NODE_ENV: 'production', TRUST_PROXY: 'loopback, 10.0.0.0/8' },
    ip: '203.0.113.2',
    forwarded: true,
  },
  {
    name: 'published development direct access',
    env: { NODE_ENV: 'development' },
    ip: '127.0.0.1',
    forwarded: false,
  },
  {
    name: 'explicit untrusted peer',
    env: { NODE_ENV: 'production', TRUST_PROXY: '192.0.2.0/24' },
    ip: '127.0.0.1',
    forwarded: false,
  },
  {
    name: 'existing Express named subnet setting',
    env: { NODE_ENV: 'development', TRUST_PROXY: 'loopback' },
    ip: '10.0.0.9',
    forwarded: true,
  },
];

function echoApplication(env) {
  const app = express();
  configureProxyTrust(app, env);
  app.use(
    session({
      secret: 'synthetic-access-compatibility-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: 'auto' },
    })
  );
  app.get('/', (req, res) => {
    req.session.visited = true;
    res.json({
      ip: req.ip.replace('::ffff:', ''),
      protocol: req.protocol,
      hostname: req.hostname,
    });
  });
  return app;
}

const close = (server) => new Promise((resolve) => server.close(resolve));
const control = { state: async () => ({ maintenance: false }) };

for (const scenario of cases) {
  test(`HTTP recovery hop preserves ${scenario.name}`, async () => {
    const upstream = echoApplication({ TRUST_PROXY: 'loopback' }).listen(
      0,
      '127.0.0.1'
    );
    await once(upstream, 'listening');
    try {
      const gateway = createRecoveryGateway(control, {
        ...scenario.env,
        BASE_URL: 'https://unrelated.example',
        RECOVERY_APP_URL: `http://127.0.0.1:${upstream.address().port}`,
      });
      const direct = await request(echoApplication(scenario.env))
        .get('/')
        .set(headers)
        .expect(200);
      const proxied = await request(gateway).get('/').set(headers).expect(200);
      assert.deepEqual(proxied.body, direct.body);
      assert.equal(proxied.body.ip, scenario.ip);
      assert.equal(
        proxied.body.protocol,
        scenario.forwarded ? 'https' : 'http'
      );
      assert.equal(
        proxied.body.hostname,
        scenario.forwarded ? 'public.example' : 'origin.example'
      );
      assert.equal(
        proxied.headers['set-cookie'][0].includes('; Secure'),
        scenario.forwarded
      );
    } finally {
      await close(upstream);
    }
  });

  test(
    `WebSocket recovery hop preserves ${scenario.name}`,
    { timeout: 5000 },
    async () => {
      const upstream = http.createServer();
      const sockets = new WebSocketServer({ server: upstream });
      sockets.on('connection', (socket, req) =>
        socket.send(
          JSON.stringify({
            ip: req.headers['x-forwarded-for'],
            protocol: req.headers['x-forwarded-proto'],
            hostname: req.headers['x-forwarded-host'],
          })
        )
      );
      upstream.listen(0, '127.0.0.1');
      await once(upstream, 'listening');
      const env = {
        ...scenario.env,
        RECOVERY_APP_URL: `http://127.0.0.1:${upstream.address().port}`,
      };
      const gateway = http.createServer(createRecoveryGateway(control, env));
      attachWebsocketProxy(gateway, control, env);
      gateway.listen(0, '127.0.0.1');
      await once(gateway, 'listening');
      const client = new WebSocket(`ws://127.0.0.1:${gateway.address().port}`, {
        headers,
      });
      try {
        const [message] = await once(client, 'message');
        const result = JSON.parse(message.toString());
        assert.equal(result.ip.replace('::ffff:', ''), scenario.ip);
        assert.equal(result.protocol, scenario.forwarded ? 'https' : 'http');
        assert.equal(
          result.hostname,
          scenario.forwarded ? 'public.example' : 'origin.example'
        );
      } finally {
        client.terminate();
        for (const socket of sockets.clients) socket.terminate();
        await close(sockets);
        await close(gateway);
        await close(upstream);
      }
    }
  );
}

test('startup verification still gates access before the recovery hop opens', async () => {
  const app = createRecoveryGateway(control, {
    NODE_ENV: 'production',
    DEPLOYMENT_VERIFY_ONLY: 'true',
  });
  await request(app).get('/').expect(503);
});
