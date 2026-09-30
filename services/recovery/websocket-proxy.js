const http = require('node:http');
const https = require('node:https');
const express = require('express');
const { configureProxyTrust } = require('../../config/network-trust');

function attachWebsocketProxy(server, control, env = process.env) {
  const target = new URL(env.RECOVERY_APP_URL || 'http://app:3000');
  const app = express();
  configureProxyTrust(app, env);
  server.on('upgrade', async (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    try {
      const state = await control.state();
      if (
        env.DEPLOYMENT_VERIFY_ONLY === 'true' ||
        !state ||
        state.maintenance ||
        state.operation_id
      ) {
        socket.destroy();
        return;
      }
      const transport = target.protocol === 'https:' ? https : http;
      // Upgrade requests bypass Express routing. Use the same request getters
      // as HTTP so the internal recovery hop preserves the published policy.
      const request = Object.assign(Object.create(app.request), {
        socket: req.socket,
        headers: req.headers,
      });
      const upstream = transport.request({
        hostname: target.hostname,
        port: target.port,
        protocol: target.protocol,
        method: req.method,
        path: req.url,
        headers: {
          ...req.headers,
          'x-forwarded-for': request.ip,
          'x-forwarded-proto': request.protocol,
          'x-forwarded-host': request.host,
        },
      });
      upstream.setTimeout(10000, () => upstream.destroy());
      upstream.on('error', () => socket.destroy());
      upstream.on('response', (response) => {
        response.resume();
        socket.destroy();
      });
      upstream.on('upgrade', (response, backend, backendHead) => {
        upstream.setTimeout(0);
        backend.on('error', () => socket.destroy());
        socket.once('close', () => backend.destroy());
        backend.once('close', () => socket.destroy());
        socket.write(
          `HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`
        );
        for (let i = 0; i < response.rawHeaders.length; i += 2)
          socket.write(
            `${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}\r\n`
          );
        socket.write('\r\n');
        if (head.length) backend.write(head);
        if (backendHead.length) socket.write(backendHead);
        socket.pipe(backend).pipe(socket);
      });
      upstream.end();
    } catch {
      socket.destroy();
    }
  });
}
module.exports = { attachWebsocketProxy };
