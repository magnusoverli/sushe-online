const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const HASHED_STYLE_RE = /^\/styles\/(app|output)-([a-f0-9]{12})\.css$/;
const STYLE_ASSET_PATHS = ['/styles/app.css', '/styles/output.css'];

/**
 * Build a map of canonical style asset path -> content-hashed path.
 *
 * @param {Object} [options]
 * @param {string} [options.publicDir] - Root of the served public directory
 * @param {typeof fs} [options.fsModule] - Injectable fs module (tests)
 * @returns {Record<string, string>}
 */
function createStyleAssetManifest({ publicDir, fsModule = fs } = {}) {
  const root = publicDir || path.join(__dirname, '..', 'public');
  const manifest = {};

  STYLE_ASSET_PATHS.forEach((assetPath) => {
    const filePath = path.join(root, assetPath.slice(1));

    try {
      const content = fsModule.readFileSync(filePath);
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      manifest[assetPath] = assetPath.replace(
        '.css',
        `-${hash.slice(0, 12)}.css`
      );
    } catch (_error) {
      // Fall back to query-string versioning if the build artifact is absent.
    }
  });

  return manifest;
}

/**
 * Resolve a canonical style asset path to its content-hashed variant.
 *
 * @param {Object} [options]
 * @param {string} [options.publicDir] - Root of the served public directory
 * @param {typeof fs} [options.fsModule] - Injectable fs module (tests)
 * @param {boolean} [options.cache=true] - Reuse the manifest across calls
 * @returns {(assetPath: string) => string|undefined}
 */
function createStyleAssetResolver({
  publicDir,
  fsModule = fs,
  cache = true,
} = {}) {
  /** @type {Record<string, string>|null} */
  let manifest = null;

  return (assetPath) => {
    if (!STYLE_ASSET_PATHS.includes(assetPath)) return undefined;

    if (!cache || manifest === null) {
      manifest = createStyleAssetManifest({ publicDir, fsModule });
    }

    return manifest[assetPath];
  };
}

/**
 * Express middleware that serves hashed style URLs from the unhashed files.
 *
 * @param {Object} [options]
 * @param {string} [options.publicDir] - Root of the served public directory
 * @returns {import('express').RequestHandler}
 */
function createHashedStyleMiddleware({ publicDir } = {}) {
  const root = publicDir || path.join(__dirname, '..', 'public');

  return (req, res, next) => {
    const match = req.path.match(HASHED_STYLE_RE);
    if (!match) {
      next();
      return;
    }

    res.sendFile(path.join(root, 'styles', `${match[1]}.css`), (error) => {
      if (error) next();
    });
  };
}

module.exports = {
  createHashedStyleMiddleware,
  createStyleAssetManifest,
  createStyleAssetResolver,
};
