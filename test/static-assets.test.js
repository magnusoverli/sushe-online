const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const {
  createHashedStyleMiddleware,
  createStyleAssetManifest,
  createStyleAssetResolver,
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

  it('can recompute stylesheet hashes without caching', () => {
    let appCss = 'first app css';
    const files = {
      [path.join('/public', 'styles', 'output.css')]: 'output css',
    };
    const fsModule = {
      readFileSync(filePath) {
        if (filePath === path.join('/public', 'styles', 'app.css')) {
          return appCss;
        }
        if (!(filePath in files)) throw new Error('missing');
        return files[filePath];
      },
    };
    const resolver = createStyleAssetResolver({
      publicDir: '/public',
      fsModule,
      cache: false,
    });

    const firstPath = resolver('/styles/app.css');
    appCss = 'changed app css';
    const secondPath = resolver('/styles/app.css');

    assert.notStrictEqual(firstPath, secondPath);
    assert.match(secondPath, /^\/styles\/app-[a-f0-9]{12}\.css$/);
  });

  it('does not resolve non-stylesheet assets', () => {
    const resolver = createStyleAssetResolver({ publicDir: '/public' });

    assert.strictEqual(resolver('/images/logo.svg'), undefined);
  });
});
