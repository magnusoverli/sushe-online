const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { loadState } = require('../../services/deployment/legacy-state');

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
