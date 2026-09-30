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
