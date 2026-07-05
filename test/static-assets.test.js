const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const {
  createHashedStyleMiddleware,
  createStyleAssetManifest,
} = require('../utils/static-assets');

describe('static-assets', () => {
  it('creates content-hashed stylesheet paths', () => {
    const files = {
      [path.join('/public', 'styles', 'app.css')]: 'app css',
      [path.join('/public', 'styles', 'output.css')]: 'output css',
    };

    const manifest = createStyleAssetManifest({
      publicDir: '/public',
      fsModule: {
        readFileSync(filePath) {
          if (!(filePath in files)) throw new Error('missing');
          return files[filePath];
        },
      },
    });

    assert.match(
      manifest['/styles/app.css'],
      /^\/styles\/app-[a-f0-9]{12}\.css$/
    );
    assert.match(
      manifest['/styles/output.css'],
      /^\/styles\/output-[a-f0-9]{12}\.css$/
    );
  });

  it('serves hashed stylesheet paths from the canonical CSS file', () => {
    const middleware = createHashedStyleMiddleware({ publicDir: '/public' });
    let sentFile = null;
    let nextCalled = false;

    middleware(
      { path: '/styles/app-abcdef123456.css' },
      {
        sendFile(filePath) {
          sentFile = filePath;
        },
      },
      () => {
        nextCalled = true;
      }
    );

    assert.strictEqual(sentFile, path.join('/public', 'styles', 'app.css'));
    assert.strictEqual(nextCalled, false);
  });
});
