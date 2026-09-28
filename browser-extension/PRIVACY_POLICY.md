# Privacy policy — SuShe Online RateYourMusic integration

Last updated: September 28, 2026.

## Data accessed and transmitted

On RateYourMusic pages, the extension reads album links and page content to identify albums and display list-membership badges. When adding an album from a listing, it may request that album's RYM detail page using the browser's applicable RYM credentials. It extracts album identity, taxonomy, release metadata, and supported platform links for transmission to your configured SuShe instance.

The extension requests your lists and album membership from that instance. On your instruction it adds an album and may update its source observation and country metadata. MusicBrainz searches go through the SuShe server. The server may use other metadata or artwork providers, such as Deezer; those server-side integrations depend on your instance's configuration. Notification artwork can be requested from the selected image's host.

The extension contains no developer analytics or advertising integration. Its popup and settings styles are local; they do not load external fonts. Your SuShe operator and external services control their own server logs and retention.

## Authentication and local storage

The extension stores a bearer access token, its expiry, your configured server URL, list metadata, last-used-list information, an album presence index, and cache/account bookkeeping in Chrome's local extension storage. A pending login's tab, origin, and expiry are stored temporarily in Chrome session storage. RYM detail observations are cached in the page's extension context.

Your website session is used on the SuShe authorization page to issue a token. Subsequent extension API requests explicitly omit website cookies and use that bearer token. The extension does not store your password. A bearer token is a credential and should be treated as confidential.

Lists normally refresh after one minute and presence indexes after five minutes; visible pages also periodically validate badges. These intervals indicate freshness, not automatic deletion. Cached entries may remain during outages or while the extension is inactive. Logout, token expiry detected by the extension, or an account/server change clears account-specific credentials or caches as appropriate. Logout removes the local token but does not itself revoke it on the server. Configuration and the fact that the extension has previously authenticated may remain until uninstall or storage removal.

## Permissions

| Permission                      | Purpose                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `contextMenus`                  | Show album-add and list-selection actions on RYM.                            |
| `storage`                       | Store settings, authentication, and account caches.                          |
| `notifications`                 | Report album-add outcomes and errors.                                        |
| `scripting`                     | Restore RYM content-script communication and navigate an existing SuShe tab. |
| RYM host access                 | Read album content and display membership badges.                            |
| Localhost/127.0.0.1 HTTP access | Connect to local development instances.                                      |
| HTTPS host access               | Support user-configured SuShe origins and their authorization pages.         |

An authorization listener is installed on matching `/extension/auth` pages. The worker accepts token completion only from the pending top-level tab at the configured origin. Broad HTTPS permission supports configurable instances; it is not used to scan arbitrary websites. The extension does not request the `cookies` permission.

## Your controls

Use extension Settings to change the instance or log out. Revoke issued tokens through your SuShe instance's account settings when server-side revocation is needed. Uninstalling the extension removes its local storage; this does not delete albums already saved to your server. Contact your SuShe instance administrator for server-side data questions, and use the project's issue tracker for extension issues without posting tokens or passwords.
