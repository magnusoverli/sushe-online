const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { loadState } = require('../../services/deployment/legacy-state');

test('unsupported server refusal leaves the old app volume untouched', async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'deployment-old-major-')
  );
  try {
    await fs.writeFile(path.join(root, 'retained'), 'old app data');
    const before = await fs.stat(root);
    await assert.rejects(
      loadState({ DATA_DIR: root }, async () => {
        throw new Error('PostgreSQL 19 is required');
      }),
      /PostgreSQL 19/
    );
    assert.deepEqual(await fs.readdir(root), ['retained']);
    assert.equal((await fs.stat(root)).mode, before.mode);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('completed cutover requires its app receipt and existing deployment state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deployment-cutover-'));
  const env = {
    DATA_DIR: root,
    NODE_ENV: 'production',
    SUSHE_PG19_CUTOVER_ID: '123456',
  };
  try {
    await assert.rejects(loadState(env), { code: 'ENOENT' });
    await fs.mkdir(path.join(root, '.deployment'), { mode: 0o700 });
    const receipt = path.join(root, '.deployment', '.sushe-tower19-complete');
    await fs.writeFile(receipt, '987\n');
    await assert.rejects(loadState(env), /matching PostgreSQL 19/);
    await fs.writeFile(receipt, '123456\n');
    await assert.rejects(loadState(env), { code: 'ENOENT' });
    await assert.rejects(fs.stat(path.join(root, '.deployment/state.json')), {
      code: 'ENOENT',
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('image-only data relocation refuses to overwrite existing files', async () => {
  assert.equal(process.env.DEPLOYMENT_REHEARSAL, 'disposable');
  assert.equal(process.getuid(), 0);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deployment-state-'));
  try {
    await fs.mkdir(path.join(root, 'application'));
    await fs.writeFile(path.join(root, 'retained'), 'original');
    await fs.writeFile(path.join(root, 'application', 'retained'), 'existing');
    await assert.rejects(
      loadState({ NODE_ENV: 'production', DATA_DIR: root }),
      /overwrite/
    );
    assert.equal(
      await fs.readFile(path.join(root, 'retained'), 'utf8'),
      'original'
    );
    assert.equal(
      await fs.readFile(path.join(root, 'application', 'retained'), 'utf8'),
      'existing'
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('image-only state rejects an app-owned credential directory', async () => {
  assert.equal(process.env.DEPLOYMENT_REHEARSAL, 'disposable');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deployment-state-'));
  try {
    const directory = path.join(root, '.deployment');
    await fs.mkdir(directory, { mode: 0o700 });
    await fs.chown(directory, 1000, 1000);
    await assert.rejects(
      loadState({ NODE_ENV: 'production', DATA_DIR: root }),
      /Unsafe deployment state ownership/
    );
    await assert.rejects(fs.stat(path.join(directory, 'state.json')), {
      code: 'ENOENT',
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
