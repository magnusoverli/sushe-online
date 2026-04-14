const {
  adjustColor,
  colorWithOpacity,
  generateAccentCssVars,
  generateAccentOverrides,
} = require('./utils/color-utils');
const {
  createAssetHelper,
  escapeHtml,
  safeJsonStringify,
  modalShell,
  menuItem,
  formatDate,
  formatDateTime,
} = require('./utils/template-helpers');
const { createAuthTemplates } = require('./templates/auth-templates');
const {
  extensionAuthTemplate,
} = require('./templates/extension-auth-template');

const {
  createAggregateListTemplate,
} = require('./templates/aggregate-list-template');

const { createSpotifyTemplate } = require('./templates/spotify-template');
const { createSpotifyComponents } = require('./templates/spotify-components');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
// Use a timestamp-based asset version to avoid browser caching issues
const assetVersion = process.env.ASSET_VERSION || Date.now().toString();
const asset = createAssetHelper(assetVersion);

const viewsDir = path.join(__dirname, 'views');
// Precompile EJS templates for caching
const layoutTemplateFn = ejs.compile(
  fs.readFileSync(path.join(viewsDir, 'layout.ejs'), 'utf8'),
  { filename: 'layout.ejs', cache: true }
);
const loginSnippetFn = ejs.compile(
  fs.readFileSync(path.join(viewsDir, 'login.ejs'), 'utf8'),
  { filename: 'login.ejs', cache: true }
);

// Base HTML template rendered with EJS
const htmlTemplate = (content, title = 'SuShe Auth', user = null) =>
  layoutTemplateFn({
    content,
    title,
    user,
    asset,
    adjustColor,
    colorWithOpacity,
    generateAccentCssVars,
    generateAccentOverrides,
  });

const {
  headerComponent,
  registerTemplate,
  loginTemplate,
  forgotPasswordTemplate,
  resetPasswordTemplate,
  invalidTokenTemplate,
} = createAuthTemplates({
  escapeHtml,
  htmlTemplate,
  loginSnippetFn,
});

const { contextMenusComponent, settingsDrawerComponent, modalPortalComponent } =
  createSpotifyComponents({
    modalShell,
    menuItem,
  });

const spotifyTemplate = createSpotifyTemplate({
  asset,
  generateAccentCssVars,
  generateAccentOverrides,
  headerComponent,
  contextMenusComponent,
  settingsDrawerComponent,
  modalPortalComponent,
  safeJsonStringify,
});

const aggregateListTemplate = createAggregateListTemplate({
  asset,
  generateAccentCssVars,
  generateAccentOverrides,
  headerComponent,
});

module.exports = {
  htmlTemplate,
  registerTemplate,
  loginTemplate,
  forgotPasswordTemplate,
  resetPasswordTemplate,
  invalidTokenTemplate,
  spotifyTemplate,
  aggregateListTemplate,
  extensionAuthTemplate,
  headerComponent,
  formatDate,
  formatDateTime,
  asset,
};
