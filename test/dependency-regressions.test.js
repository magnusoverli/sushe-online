const { test } = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const sharp = require('sharp');
const express = require('express');
const request = require('supertest');

test('updated SMTP transport authenticates and delivers to a local stub server', async () => {
  const net = require('node:net');
  let authenticated = false;
  let delivered = false;
  const server = net.createServer((socket) => {
    let buffer = '';
    let dataMode = false;
    socket.write('220 fixture ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk;
      while (buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n');
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (dataMode) {
          if (line === '.') {
            dataMode = false;
            delivered = true;
            socket.write('250 queued\r\n');
          }
        } else if (/^EHLO/.test(line))
          socket.write('250-fixture\r\n250 AUTH PLAIN\r\n');
        else if (/^AUTH PLAIN /.test(line)) {
          authenticated = true;
          socket.write('235 accepted\r\n');
        } else if (line === 'DATA') {
          dataMode = true;
          socket.write('354 send message\r\n');
        } else if (line === 'QUIT') socket.end('221 goodbye\r\n');
        else socket.write('250 accepted\r\n');
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const transport = nodemailer.createTransport({
    host: '127.0.0.1',
    port: server.address().port,
    secure: false,
    ignoreTLS: true,
    auth: { user: 'synthetic', pass: 'synthetic-only' },
    connectionTimeout: 2000,
    socketTimeout: 2000,
  });
  try {
    await transport.sendMail({
      from: 'sender@example.test',
      to: 'recipient@example.test',
      subject: 'Fixture',
      text: 'Synthetic message',
    });
    assert.ok(authenticated);
    assert.ok(delivered);
  } finally {
    transport.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('updated mail transport produces bounded, valid reset messages without external delivery', async () => {
  const transport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: 'unix',
  });
  const result = await transport.sendMail({
    from: 'test@example.test',
    to: 'user@example.test',
    subject: 'Reset',
    text: 'Open your reset link',
    html: '<p>Open your reset link</p>',
  });
  const message = result.message.toString();
  assert.match(message, /multipart\/alternative/);
  assert.match(message, /Subject: Reset/);
  assert.match(message, /Open your reset link/);
  assert.ok(message.length < 4096);
});

test('production sharp decodes images and enforces input pixel limits', async () => {
  const image = await sharp({
    create: { width: 32, height: 32, channels: 3, background: '#123456' },
  })
    .png()
    .toBuffer();
  const decoded = await sharp(image, { limitInputPixels: 1024 })
    .resize(8, 8)
    .jpeg()
    .toBuffer();
  assert.equal((await sharp(decoded).metadata()).width, 8);
  await assert.rejects(
    sharp(image, { limitInputPixels: 16 }).toBuffer(),
    /pixel limit/
  );
});

test('updated query parser preserves repeated values without prototype pollution', async () => {
  const app = express();
  app.set('query parser', 'extended');
  app.get('/', (req, res) => res.json(req.query));
  const response = await request(app)
    .get('/?tag=one&tag=two&__proto__[polluted]=true')
    .expect(200);
  assert.deepEqual(response.body.tag, ['one', 'two']);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.hasOwn(response.body, '__proto__'), false);
});

test('the stable Anthropic SDK uses the new API version without removed sampling parameters', async () => {
  const { Anthropic } = require('@anthropic-ai/sdk');
  let requestHeaders;
  let body;
  const client = new Anthropic({
    apiKey: 'synthetic-offline-fixture',
    maxRetries: 0,
    fetch: async (_url, options) => {
      requestHeaders = new Headers(options.headers);
      body = JSON.parse(options.body);
      return new globalThis.Response(
        JSON.stringify({
          id: 'fixture',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-5',
          content: [{ type: 'text', text: 'Offline fixture' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    },
  });
  const message = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 32,
    messages: [{ role: 'user', content: 'Offline fixture' }],
  });
  assert.equal(requestHeaders.get('anthropic-version'), '2026-10-21');
  for (const parameter of ['temperature', 'top_p', 'top_k'])
    assert.ok(!Object.hasOwn(body, parameter));
  assert.equal(message.content[0].text, 'Offline fixture');
});

test('EJS 7 keeps template output escaped and inherited locals inaccessible', () => {
  const ejs = require('ejs');
  const data = Object.assign(Object.create({ inherited: 'Must not render' }), {
    value: '<script>alert(1)</script>',
  });
  assert.equal(
    ejs.render('<%= value %>|<%= typeof inherited %>', data),
    '&lt;script&gt;alert(1)&lt;/script&gt;|undefined'
  );
});

test('patched request parsing rejects compressed trailing bytes without taking down the server', async () => {
  const { gzipSync } = require('node:zlib');
  const app = express();
  app.use(express.json({ type: 'application/octet-stream' }));
  app.post('/', (req, res) => res.json(req.body));
  app.use((error, _req, res, _next) =>
    res.status(error.status || 500).json({ error: 'invalid_body' })
  );
  const compressed = gzipSync(Buffer.from('{"value":1}'));
  const send = (body) =>
    request(app)
      .post('/')
      .set('Content-Type', 'application/octet-stream')
      .set('Content-Encoding', 'gzip')
      .send(body);
  await send(compressed).expect(200, { value: 1 });
  await send(
    Buffer.concat([compressed, Buffer.from('invalid trailing bytes')])
  ).expect(400);
  await send(compressed).expect(200, { value: 1 });
});

test('patched query serialization handles non-callable own toString values', () => {
  const qs = require('qs');
  assert.doesNotThrow(() =>
    qs.stringify(
      { value: [{ toString: 'not callable' }] },
      { arrayFormat: 'comma' }
    )
  );
});

test('ESLint and its config matcher work with Minimatch 11 without changing import-plugin APIs', () => {
  const { createRequire } = require('node:module');
  const eslintRequire = createRequire(require.resolve('eslint'));
  const configRequire = createRequire(
    eslintRequire.resolve('@eslint/config-array')
  );
  for (const load of [eslintRequire, configRequire]) {
    assert.match(load('minimatch/package.json').version, /^11\./);
    const { Minimatch } = load('minimatch');
    assert.equal(
      new Minimatch('src/**/*.js').match('src/js/modules/app-api-client.js'),
      true
    );
    assert.equal(
      new Minimatch('src/**/*.js').match('test/basic.test.js'),
      false
    );
    assert.equal(
      new Minimatch('**/a/b/c/**/d/**').match('x/a/b/c/y/d/z'),
      true
    );
  }
  const importRequire = createRequire(
    require.resolve('eslint-plugin-import-x')
  );
  assert.equal(typeof importRequire('minimatch').makeRe, 'function');
});
