const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { io } = require('socket.io-client');
const { createWebSocketService } = require('../utils/websocket');
const { createProcessHandlers } = require('../config/process-handlers');
const { createMockLogger } = require('./helpers');

test('strict WebSocket policy accepts its own public origin without BASE_URL', async () => {
  const previousMode = process.env.CORS_STRICT_MODE;
  const previousBase = process.env.BASE_URL;
  process.env.CORS_STRICT_MODE = 'true';
  delete process.env.BASE_URL;
  const websocket = createWebSocketService({ logger: createMockLogger() });
  const server = http.createServer();
  websocket.setup(server, (req, _res, next) => {
    req.session = { passport: { user: 'user' } };
    next();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const socket = io(`http://127.0.0.1:${server.address().port}`, {
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: { Host: 'sushe.example', Origin: 'https://sushe.example' },
  });
  try {
    await Promise.race([
      once(socket, 'connect'),
      once(socket, 'connect_error').then(([error]) => {
        throw error;
      }),
    ]);
    assert.equal(socket.connected, true);
  } finally {
    socket.disconnect();
    await websocket.shutdown();
    if (previousMode === undefined) delete process.env.CORS_STRICT_MODE;
    else process.env.CORS_STRICT_MODE = previousMode;
    if (previousBase === undefined) delete process.env.BASE_URL;
    else process.env.BASE_URL = previousBase;
  }
});

test('credential changes disconnect existing sockets and reject cached session identities on reconnect', async () => {
  let version = '0';
  const websocket = createWebSocketService({ logger: createMockLogger() });
  const server = http.createServer();
  websocket.setup(
    server,
    (req, _res, next) => {
      req.session = { passport: { user: { id: 'user', version: '0' } } };
      next();
    },
    {
      authService: {
        getUserById: async () => ({ _id: 'user', authVersion: version }),
      },
    }
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const socket = io(`http://127.0.0.1:${server.address().port}`, {
    transports: ['websocket'],
    reconnection: false,
  });
  try {
    await once(socket, 'connect');
    const disconnected = once(socket, 'disconnect');
    version = '1';
    websocket.broadcast.invalidateUserSessions('user');
    await disconnected;
    const rejected = once(socket, 'connect_error');
    socket.connect();
    await rejected;
    assert.equal(socket.connected, false);
  } finally {
    socket.disconnect();
    await websocket.shutdown();
  }
});

test('WebSocket upgrades enforce the origin policy, not only polling CORS', async () => {
  const previous = process.env.CORS_STRICT_MODE;
  process.env.CORS_STRICT_MODE = 'true';
  const websocket = createWebSocketService({ logger: createMockLogger() });
  const server = http.createServer();
  websocket.setup(server, (req, _res, next) => {
    req.session = { passport: { user: 'user' } };
    next();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const socket = io(`http://127.0.0.1:${server.address().port}`, {
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: { Origin: 'https://attacker.example' },
  });
  try {
    await once(socket, 'connect_error');
    assert.equal(socket.connected, false);
  } finally {
    socket.disconnect();
    await websocket.shutdown();
    if (previous === undefined) delete process.env.CORS_STRICT_MODE;
    else process.env.CORS_STRICT_MODE = previous;
  }
});

test('stopping sync services cancels startup timers as well as recurring work', async (t) => {
  const {
    createPreferenceSyncService,
  } = require('../services/preference-sync');
  const {
    createPlaycountSyncService,
  } = require('../services/playcount-sync-service');
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let queries = 0;
  const db = {
    raw: async () => {
      queries++;
      return { rows: [] };
    },
  };
  for (const createService of [
    createPreferenceSyncService,
    createPlaycountSyncService,
  ]) {
    const service = createService({ db, logger: createMockLogger() });
    service.start();
    await service.stop();
  }
  t.mock.timers.tick(24 * 60 * 60 * 1000);
  assert.equal(queries, 0);
});

test('production shutdown order drains a real upgraded connection before database cleanup', async () => {
  const logger = createMockLogger();
  const websocket = createWebSocketService({ logger });
  const server = http.createServer((_req, res) => res.end('ok'));
  websocket.setup(server, (req, _res, next) => {
    req.session = { passport: { user: 'user' } };
    next();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const socket = io(`http://127.0.0.1:${server.address().port}`, {
    transports: ['websocket'],
    reconnection: false,
  });
  const events = [];
  const handlers = createProcessHandlers({
    logger,
    getResponseCache: () => null,
    shutdownWebSocket: () => websocket.shutdown(),
    forceExitTimeoutMs: 1000,
    processRef: { exit: (code) => events.push(['exit', code]) },
  });
  try {
    await once(socket, 'connect');
    await handlers.gracefulShutdown('test', {
      closeHttpServer: () => new Promise((resolve) => server.close(resolve)),
      runCleanup: async () => events.push('cleanup'),
      closeDatabasePool: async () => events.push('database'),
    });
    assert.deepEqual(events, ['cleanup', 'database', ['exit', 0]]);
  } finally {
    socket.disconnect();
    await websocket.shutdown();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
});
