const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const HASHED_STYLE_RE = /^\/styles\/(app|output)-([a-f0-9]{12})\.css$/;
const STYLE_ASSET_PATHS = ['/styles/app.css', '/styles/output.css'];

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

function createStyleAssetResolver({
  publicDir,
  fsModule = fs,
  cache = true,
} = {}) {
  let manifest = null;

  return (assetPath) => {
    if (!STYLE_ASSET_PATHS.includes(assetPath)) return undefined;

    if (!cache || manifest === null) {
      manifest = createStyleAssetManifest({ publicDir, fsModule });
    }

    return manifest[assetPath];
  };
}

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
