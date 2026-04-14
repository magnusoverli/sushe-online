const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const viewsDir = path.join(__dirname, '../views');
const spotifyPageTemplateFn = ejs.compile(
  fs.readFileSync(path.join(viewsDir, 'spotify-page.ejs'), 'utf8'),
  { filename: 'spotify-page.ejs', cache: true }
);

function createSpotifyTemplate(deps) {
  const {
    asset,
    generateAccentCssVars,
    generateAccentOverrides,
    headerComponent,
    contextMenusComponent,
    settingsDrawerComponent,
    modalPortalComponent,
    safeJsonStringify,
  } = deps;

  return (user, csrfToken = '') =>
    spotifyPageTemplateFn({
      user,
      csrfToken,
      asset,
      generateAccentCssVars,
      generateAccentOverrides,
      headerComponent,
      contextMenusComponent,
      settingsDrawerComponent,
      modalPortalComponent,
      safeJsonStringify,
    });
}

module.exports = {
  createSpotifyTemplate,
};
