const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  isLegacyDeployment,
  socketUrl,
  sessionSecretFor,
} = require('../services/deployment/legacy-state');
const { databaseConfig } = require('../config/database-connection');

test('legacy session signing preserves strong secrets, replaces weak defaults once, and permits explicit rotation', () => {
  const strong = 'synthetic-signing-secret-0123456789-ABCDEF';
  const env = { NODE_ENV: 'production', SESSION_SECRET: strong };
  assert.equal(sessionSecretFor(env), strong);
  const weak = { ...env, SESSION_SECRET: 'your-secret-key' };
  const generated = sessionSecretFor(weak);
  assert.match(generated, /^[a-f0-9]{64}$/);
  assert.equal(sessionSecretFor(weak, generated), generated);
  assert.equal(sessionSecretFor(env, generated), strong);
});

test('automatic adoption is restricted to the published production command and database socket', () => {
  const env = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://postgres:example@/sushe?host=/var/run/postgresql',
  };
  assert.equal(isLegacyDeployment(env, ['node', 'index.js']), true);
  assert.equal(
    isLegacyDeployment({ ...env, NODE_ENV: 'test' }, ['node', 'index.js']),
    false
  );
  assert.equal(
    isLegacyDeployment({ ...env, CONTROL_DATABASE_URL: 'configured' }, [
      'node',
      'index.js',
    ]),
    false
  );
  assert.equal(
    isLegacyDeployment(env, ['node', 'scripts/start-app.js']),
    false
  );
  assert.equal(
    isLegacyDeployment(
      { ...env, DATABASE_URL: 'postgres://postgres:example@remote/sushe' },
      ['node', 'index.js']
    ),
    false
  );
  assert.equal(
    isLegacyDeployment(
      { ...env, DATABASE_URL: socketUrl('postgres', 'password', 'other') },
      ['node', 'index.js']
    ),
    false
  );
});

test('generated role connections retain exact credentials and target the authenticated local socket', () => {
  const connection = databaseConfig(
    socketUrl('sushe_runtime', 'synthetic:/?#@', 'sushe_candidate')
  );
  assert.equal(connection.user, 'sushe_runtime');
  assert.equal(connection.password, 'synthetic:/?#@');
  assert.equal(connection.host, '/var/run/postgresql');
  assert.equal(connection.database, 'sushe_candidate');
});
