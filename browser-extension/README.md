# SuShe Online — RateYourMusic integration

This Manifest V3 Chromium extension adds albums from RateYourMusic to your configured SuShe Online instance and shows badges for albums already in your lists.

## Setup and use

1. Open `chrome://extensions`, enable developer mode, choose **Load unpacked**, and select `browser-extension`.
2. Open extension Settings and enter your instance origin, such as `https://sushe.example.com`. HTTP is supported only for `localhost` and `127.0.0.1`.
3. Choose **Login**, sign in to your instance, and authorize the extension in the tab it opens. Website login alone does not authenticate the extension.
4. On RYM, right-click an album image or album link and choose a SuShe list. The popup provides manual list refresh and logout.

The connection test checks server reachability; the Authentication section separately reports extension sign-in status.

## Data flow

- The content script reads RYM album URLs and detail-page content. From listings it may fetch the selected album's RYM detail page to collect identity, genres, descriptors, release metadata, and platform links.
- The background worker searches MusicBrainz through your SuShe server. It requires a unique artist/title match; uncertain matches should be added manually in SuShe.
- Album additions use `PATCH /api/lists/:id/items`. Optional metadata and source observations are sent to the album endpoints. Cover/tracks enrichment may also be performed by the server.
- Presence badges use `/api/lists/presence`, with a full-list fallback for older servers. Badge links can reuse a tab of the configured SuShe instance.
- SuShe API calls use the extension's bearer token and explicitly omit website cookies. Account changes invalidate ongoing operations and account-specific caches.

Only RYM `release/album` URLs are currently supported. See [PRIVACY_POLICY.md](PRIVACY_POLICY.md) for access, storage, and retention details.

## Caches and recovery

Lists are normally fresh for one minute and presence indexes for five minutes; visible pages periodically validate membership. Cached results remain available during temporary failures. Cache expiry triggers refresh, not automatic deletion. Incomplete detail observations can be retried.

If page communication fails after an extension update, reload the RYM page. For rejected or expired authorization, start Login again from Settings. For an ambiguous MusicBrainz match, select the album manually in SuShe rather than accepting a guessed identity.

## Development and packaging

The worker composes account state, list cache, presence, menu, navigation, and album-add services. Popup/settings pages obtain state through authorized worker messages. Scripts are packaged without a bundling step.

From the repository root, run `npm run package:extension`, or run `./package-for-store.sh` from this directory. The archive is `browser-extension/sushe-online-extension-<manifest-version>.zip`, with `manifest.json` at its root.

Use the repository's specified Node version. Run strict lint and the extension unit/package tests, then `PLAYWRIGHT_SKIP_SERVER=1 npx playwright test test/e2e/extension-auth.spec.js` after installing Playwright Chromium. The extension E2E suite starts an isolated local fixture server; it needs no production account.
