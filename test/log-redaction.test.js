const { test } = require('node:test');
const assert = require('node:assert/strict');
const { redactLogValue } = require('../utils/log-redaction');
const { resolveSessionSettings } = require('../config/session');
const { createLogger, LogLevels } = require('../utils/logger');

test('Pino output and child bindings redact credentials at every log level', () => {
  let output = '';
  const logger = createLogger({
    level: LogLevels.DEBUG,
    stream: {
      write(chunk) {
        output += chunk;
      },
    },
  });
  const child = logger.child({
    nested: { refresh_token: 'CHILD_CANARY' },
    requestId: 'request-1',
  });
  for (const level of ['debug', 'info', 'warn', 'error']) {
    logger[level]('diagnostic', {
      hash: 'HASH_CANARY',
      params: ['SQL_CANARY'],
      deep: { password: 'PASS_CANARY' },
    });
    child[level]('diagnostic', { headers: { authorization: 'AUTH_CANARY' } });
  }
  assert.doesNotMatch(output, /CANARY/);
  assert.match(output, /request-1/);
});

test('nested credentials, SQL arrays, errors and URLs do not expose canary values', () => {
  const canary = 'PRIVATE_CANARY';
  const output = JSON.stringify(
    redactLogValue({
      password: canary,
      nested: [{ oauth: { access_token: canary, refreshToken: canary } }],
      headers: {
        Authorization: `Bearer ${canary}`,
        Cookie: canary,
        'set-cookie': canary,
      },
      params: [canary],
      token_hash: canary,
      smtpPassword: canary,
      diagnostic: `connection postgres://user:${canary}@db/source failed`,
      error: new Error(canary),
      url: `https://user:${canary}@example.test/reset/${canary}?client_secret=${canary}`,
      message: `POST /api/telegram/webhook/${canary} password=${canary}`,
      requestId: 'useful-id',
    })
  );
  assert.ok(!output.includes(canary));
  assert.ok(output.includes('useful-id'));
});

test('production enrollment codes cannot be enabled in diagnostic logs', () => {
  const { getLoggableCode } = require('../config/admin-code');
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.equal(getLoggableCode('PRIVATE_CANARY'), '[redacted]');
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test('production secrets fail closed without an opt-in enforcement flag', () => {
  const log = { error() {} };
  for (const secret of [
    undefined,
    '',
    'your-secret-key',
    'x'.repeat(64),
    'test-secret-change-in-production-long',
  ])
    assert.throws(
      () =>
        resolveSessionSettings(
          { NODE_ENV: 'production', SESSION_SECRET: secret },
          log
        ),
      /SESSION_SECRET/
    );
  assert.ok(resolveSessionSettings({ NODE_ENV: 'test' }, log).sessionSecret);
  const secret = require('node:crypto').randomBytes(32).toString('base64');
  assert.equal(
    resolveSessionSettings(
      { NODE_ENV: 'production', SESSION_SECRET: secret },
      log
    ).sessionSecret,
    secret
  );
});
